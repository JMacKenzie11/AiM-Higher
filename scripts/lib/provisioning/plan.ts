// The provisioning plan: what creating a customer instance consists
// of, in order.
//
// STUBS. Every execute here prints what it would do and returns.
// Nothing calls Supabase, Vercel or the registry yet. The point of
// landing the shape first is that the order is the hard part and the
// API calls are the easy part: get "create the project before you
// migrate it, write the env before you redeploy, register it only once
// it answers" wrong and you get a half-provisioned customer that looks
// live and is not.
//
// Ordering rules worth stating, since a later change will be tempted
// to reorder:
//
//   * The registry row goes in LATE, deliberately. A row is what makes
//     a hostname resolvable, so writing it before the database is
//     migrated and seeded would publish a broken instance. It is the
//     switch, and the switch is thrown last.
//   * write-vercel-env comes before trigger-redeploy because the
//     running deployment reads {PREFIX}_SUPABASE_* at runtime and a
//     redeploy is what picks the new values up.
//   * verify-instance is last and is not a formality. Provisioning
//     "succeeded" is not the same claim as "a person can sign in".

import {
  HEALTHY_STATUS,
  ProjectNotHealthyError,
  migrationConnectionUrl,
  projectNameFor,
  waitForHealthy,
  type ManagementClient,
  type ManagementProject,
} from "./supabase-management.ts";
import {
  generateDbPassword,
  fingerprint,
  pickApiKeys,
  type InstanceState,
} from "./state.ts";
import {
  DEPLOYMENT_READY,
  DeploymentFailedError,
  DeploymentTimeoutError,
  planEnvVar,
  waitForDeployment,
  type VercelClient,
  type VercelEnvType,
} from "./vercel.ts";

export type StepStatus = "done" | "skipped";

export type StepResult = {
  status: StepStatus;
  // One line, shown beside the step name in the runner's output.
  detail: string;
};

export type ProvisionContext = {
  subdomain: string;
  envPrefix: string;
  displayName: string;
  adminEmail: string;
  region: string;
  // Never execute anything. The runner also refuses to call execute at
  // all in this mode; the flag rides along so a step can say so.
  dryRun: boolean;
};

// Everything a step is allowed to reach the outside world through.
//
// Injected rather than imported, so each step can be driven in a test
// with fakes: no network, no clock, no disk. The runner builds the
// real ones.
export type ProvisionDeps = {
  management: ManagementClient;
  organizationId: string;
  vercel: VercelClient;
  // Plain HTTPS GET, for the reachability check. Injected so the
  // verify step can be driven without a network.
  httpGet: (url: string) => Promise<{ status: number; body: string }>;
  // Reads and writes .provisioning-state/{subdomain}.json.
  readState: (subdomain: string) => InstanceState | null;
  writeState: (subdomain: string, patch: Partial<InstanceState>) => InstanceState;
  // Runs an external command (the Supabase CLI). Injected so the
  // migration step can be driven in a test without one installed.
  runCommand: (
    command: string,
    args: string[]
  ) => Promise<{ code: number; stdout: string; stderr: string }>;
  // The migration files this repo ships, newest last. Injected rather
  // than read from disk here, so the "is anything pending" comparison
  // is testable.
  localMigrations: () => string[];
  // Reads supabase/seed/instance-seed.sql.
  readSeedSql: () => string;
  // Progress, for the steps that take minutes.
  log: (line: string) => void;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

export type ProvisionStep = {
  // Stable identifier. Tests pin the order by these.
  name: string;
  // What this step does, in one line, with the context resolved.
  describe: (ctx: ProvisionContext) => string;
  execute: (ctx: ProvisionContext, deps: ProvisionDeps) => Promise<StepResult>;
};

// Takes deps it does not use, so every step in the list has the same
// signature whether or not it has been implemented yet. A stub that
// looked different from a real step would invite a runner that special
// cases one of them.
function stub(what: (ctx: ProvisionContext) => string) {
  return async (
    ctx: ProvisionContext,
    _deps: ProvisionDeps
  ): Promise<StepResult> => ({
    status: "done",
    detail: `stub — would ${what(ctx)}`,
  });
}

// ---- create-supabase-project ----------------------------------
//
// KEY FORMAT, checked before this was written because it could have
// stopped the whole approach.
//
// New projects issue sb_publishable_ / sb_secret_ keys rather than the
// legacy JWTs. Everything here treats them as opaque strings, and so
// does everything downstream:
//
//   * @supabase/supabase-js 2.110.5 recognises the format explicitly.
//     assertSupportedApiKey() accepts legacy JWTs and the two new
//     prefixes, and throws only for an unrecognised future sb_ subtype
//     — a guard for forward compatibility, not a restriction on us. It
//     never decodes the key.
//   * @supabase/ssr 0.12.1 forwards the key to createClient untouched.
//   * @supabase/auth-js decodes JWTs, but only ever session access
//     tokens, never the API key.
//   * Nothing in src/ or scripts/ parses, validates or pattern-matches
//     a key.
//
// And the empirical half: production already runs entirely on
// sb_publishable_ / sb_secret_ keys today, for the app, the control
// plane and the cron fallback.
//
// So no legacy-JWT dependency exists and none needs working around.

async function createSupabaseProject(
  ctx: ProvisionContext,
  deps: ProvisionDeps
): Promise<StepResult> {
  const projectName = projectNameFor(ctx.subdomain);

  // Idempotency first. Recognising an existing project by the naming
  // convention is what makes a rerun after a failure safe: creating a
  // second project for one subdomain would leave an orphan nobody is
  // paying attention to and nothing is pointing at.
  const projects = await deps.management.listProjects();
  const existing = projects.find((p) => p.name === projectName) ?? null;

  let project: ManagementProject;
  let created = false;

  if (existing) {
    deps.log(`      found ${projectName} (${existing.id}), status ${existing.status}`);
    project = existing;
  } else {
    // The password is generated here, shown once, and written to the
    // state file before anything else can fail. The Management API
    // never returns it again, and the migration step needs it.
    const dbPassword = generateDbPassword();
    deps.writeState(ctx.subdomain, {
      subdomain: ctx.subdomain,
      projectName,
      region: ctx.region,
      dbPassword,
    });
    deps.log(`      database password (shown once): ${dbPassword}`);
    deps.log(`      also written to .provisioning-state/${ctx.subdomain}.json`);

    project = await deps.management.createProject({
      name: projectName,
      organizationId: deps.organizationId,
      region: ctx.region,
      dbPass: dbPassword,
    });
    created = true;
    deps.writeState(ctx.subdomain, { projectRef: project.id });
    deps.log(`      created ${projectName} (${project.id})`);
  }

  // Poll whether it was just created or found mid-provision. A project
  // found in COMING_UP is the resume case and is waited on the same
  // way.
  if (project.status !== HEALTHY_STATUS) {
    deps.log(`      waiting for ${HEALTHY_STATUS} (up to 10 minutes)…`);
    try {
      await waitForHealthy({
        ref: project.id,
        getStatus: async () => {
          const current = await deps.management.getProject(project.id);
          return current?.status ?? "UNKNOWN";
        },
        now: deps.now,
        sleep: deps.sleep,
        onTick: (status, elapsed) =>
          deps.log(`      ${Math.round(elapsed / 1000)}s — ${status}`),
      });
    } catch (error) {
      if (error instanceof ProjectNotHealthyError) {
        throw new Error(
          `${error.message}
` +
            `      The project exists and was left in place. Rerunning ` +
            `provision resumes from it rather than creating a second one; ` +
            `check the Supabase dashboard first in case it needs attention.`
        );
      }
      throw error;
    }
  }

  // Record what everything downstream needs. The API URL is derived
  // rather than fetched: it is a documented function of the ref, and
  // one less call is one less thing to fail.
  const apiUrl = `https://${project.id}.supabase.co`;
  const keys = pickApiKeys(await deps.management.getApiKeys(project.id));
  deps.writeState(ctx.subdomain, {
    projectRef: project.id,
    region: project.region,
    apiUrl,
    anonKey: keys.anonKey,
    serviceKey: keys.serviceKey,
  });

  if (!keys.anonKey || !keys.serviceKey) {
    throw new Error(
      `Project ${project.id} is healthy but did not return both an anon ` +
        `and a service key. Nothing downstream can connect without them.`
    );
  }

  return created
    ? { status: "done", detail: `created ${projectName} (${project.id})` }
    : {
        status: "skipped",
        detail: `already exists — ${projectName} (${project.id})`,
      };
}


// ---- apply-migrations -----------------------------------------
//
// Reuses the mechanism the repo already has: `supabase db push`, the
// same command scripts/db-push.sh runs for dev and prod. The only
// difference is where the connection string comes from.
//
// db push is idempotent by design — it consults the remote
// supabase_migrations.schema_migrations table and applies only what is
// missing — so a rerun is safe. This step additionally compares the
// local and remote sets first, so a no-op rerun reports "skipped"
// instead of shelling out to say nothing happened.

const MIGRATIONS_TABLE = "supabase_migrations.schema_migrations";

// A migration filename is 0169_instances.sql; the version db push
// records is the numeric prefix.
export function migrationVersion(filename: string): string {
  return filename.split("_")[0] ?? filename;
}

async function appliedVersions(
  ref: string,
  deps: ProvisionDeps
): Promise<Set<string>> {
  try {
    const rows = await deps.management.runQuery<{ version: string }>(
      ref,
      `select version from ${MIGRATIONS_TABLE} order by version`
    );
    return new Set(rows.map((r) => String(r.version)));
  } catch {
    // The table does not exist until the first push. That is "nothing
    // applied", not a failure.
    return new Set();
  }
}

async function applyMigrations(
  ctx: ProvisionContext,
  deps: ProvisionDeps
): Promise<StepResult> {
  const state = deps.readState(ctx.subdomain);
  if (!state?.projectRef || !state.dbPassword) {
    throw new Error(
      "No project ref or database password in " +
        `.provisioning-state/${ctx.subdomain}.json. Run create-supabase-project first.`
    );
  }

  const local = deps.localMigrations();
  const applied = await appliedVersions(state.projectRef, deps);
  const pending = local.filter((f) => !applied.has(migrationVersion(f)));
  const latest = local.length > 0 ? migrationVersion(local[local.length - 1]) : null;

  if (pending.length === 0) {
    if (latest) deps.writeState(ctx.subdomain, { migrationVersion: latest });
    return {
      status: "skipped",
      detail: `already at ${latest ?? "no migrations"} — ${applied.size} applied`,
    };
  }

  const pooler = await deps.management.getPoolerConfig(state.projectRef);
  const poolerHost = pooler[0]?.db_host;
  if (!poolerHost) {
    throw new Error(
      `Project ${state.projectRef} reported no pooler host, so there is no ` +
        "IPv4-reachable way in. Check the project's database settings."
    );
  }

  const dbUrl = migrationConnectionUrl({
    poolerHost,
    ref: state.projectRef,
    password: state.dbPassword,
  });

  deps.log(`      ${pending.length} pending, pushing via ${poolerHost}…`);
  const result = await deps.runCommand("supabase", [
    "db",
    "push",
    "--db-url",
    dbUrl,
    "--include-all",
  ]);

  if (result.code !== 0) {
    // The CLI explains itself in its own output; the connection string
    // is deliberately not echoed, it carries the password.
    throw new Error(
      `supabase db push exited ${result.code}.\n` +
        `${result.stderr || result.stdout}`.trim()
    );
  }

  const after = await appliedVersions(state.projectRef, deps);
  const stillPending = local.filter((f) => !after.has(migrationVersion(f)));
  if (stillPending.length > 0) {
    throw new Error(
      `supabase db push reported success but ${stillPending.length} ` +
        `migrations are still missing remotely, starting with ` +
        `${stillPending[0]}.`
    );
  }

  if (latest) deps.writeState(ctx.subdomain, { migrationVersion: latest });
  return {
    status: "done",
    detail: `applied ${pending.length} migrations, now at ${latest}`,
  };
}

// ---- seed-data ------------------------------------------------
//
// Runs supabase/seed/instance-seed.sql through the Management API's
// SQL endpoint, so no psql is needed on the machine doing the
// provisioning.
//
// The seed is idempotent by construction (every insert carries an ON
// CONFLICT), which is what lets this run against an existing instance
// to pick up reference data added since it was built. See
// supabase/seed/README.md for the maintenance rule.

async function seedData(
  ctx: ProvisionContext,
  deps: ProvisionDeps
): Promise<StepResult> {
  const state = deps.readState(ctx.subdomain);
  if (!state?.projectRef) {
    throw new Error(
      `No project ref in .provisioning-state/${ctx.subdomain}.json. ` +
        "Run create-supabase-project first."
    );
  }

  const sql = deps.readSeedSql().trim();
  if (sql.length === 0) {
    throw new Error(
      "supabase/seed/instance-seed.sql is empty or missing. A new " +
        "instance needs its reference data; refusing to report success."
    );
  }

  await deps.management.runQuery(state.projectRef, sql);

  // Report what landed rather than just "ok". The counts are the only
  // cheap evidence that the seed did anything.
  const [counts] = await deps.management.runQuery<{
    classroom_categories: number;
    strengths_items: number;
  }>(
    state.projectRef,
    `select
       (select count(*) from public.classroom_categories) as classroom_categories,
       (select count(*) from public.strengths_items) as strengths_items`
  );

  deps.writeState(ctx.subdomain, { seededAt: new Date().toISOString() });
  return {
    status: "done",
    detail:
      `seeded — ${counts?.strengths_items ?? "?"} strengths items, ` +
      `${counts?.classroom_categories ?? "?"} classroom categories`,
  };
}


// ---- write-vercel-env -----------------------------------------
//
// Three variables per instance, on Production only:
//
//   {PREFIX}_SUPABASE_URL         encrypted
//   {PREFIX}_SUPABASE_ANON_KEY    encrypted
//   {PREFIX}_SUPABASE_SERVICE_KEY sensitive
//
// The service key is the only one marked sensitive, because it is the
// only one that is actually secret. The URL and the publishable key
// are already in the browser bundle of every page the instance serves.
//
// That is not just accuracy for its own sake: a sensitive variable's
// value is never returned by the API, so marking the readable two
// sensitive would trade away the ability to compare them and make this
// step rewrite production config on every run to learn nothing.
//
// Values are never logged. Names only.

const ENV_TARGET = ["production"];

type EnvSpec = { key: string; value: string; type: VercelEnvType };

function envSpecsFor(
  envPrefix: string,
  state: InstanceState
): EnvSpec[] {
  return [
    { key: `${envPrefix}_SUPABASE_URL`, value: state.apiUrl ?? "", type: "encrypted" },
    { key: `${envPrefix}_SUPABASE_ANON_KEY`, value: state.anonKey ?? "", type: "encrypted" },
    {
      key: `${envPrefix}_SUPABASE_SERVICE_KEY`,
      value: state.serviceKey ?? "",
      type: "sensitive",
    },
  ];
}

async function writeVercelEnv(
  ctx: ProvisionContext,
  deps: ProvisionDeps
): Promise<StepResult> {
  const state = deps.readState(ctx.subdomain);
  if (!state?.apiUrl || !state.anonKey || !state.serviceKey) {
    throw new Error(
      `.provisioning-state/${ctx.subdomain}.json has no URL or keys. ` +
        "Run create-supabase-project first."
    );
  }

  const specs = envSpecsFor(ctx.envPrefix, state);
  const existing = await deps.vercel.listEnv();
  const byKey = new Map(
    existing
      .filter((e) => (e.target ?? []).includes("production"))
      .map((e) => [e.key, e])
  );

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const spec of specs) {
    const plan = planEnvVar({
      key: spec.key,
      desiredValue: spec.value,
      type: spec.type,
      existing: byKey.get(spec.key),
      recordedFingerprint: state.envFingerprints?.[spec.key],
      fingerprintOf: fingerprint,
    });

    // Names and decisions only. Never the value.
    deps.log(`      ${plan.key} — ${plan.action} (${plan.reason})`);

    if (plan.action === "create") {
      await deps.vercel.createEnv({
        key: spec.key,
        value: spec.value,
        type: spec.type,
        target: ENV_TARGET,
      });
      created += 1;
    } else if (plan.action === "update") {
      await deps.vercel.updateEnv(plan.existingId as string, {
        value: spec.value,
        type: spec.type,
        target: ENV_TARGET,
      });
      updated += 1;
    } else {
      skipped += 1;
    }
  }

  deps.writeState(ctx.subdomain, {
    envFingerprints: Object.fromEntries(
      specs.map((spec) => [spec.key, fingerprint(spec.value)])
    ),
    // When the config last changed. trigger-redeploy compares a
    // deployment's age against this to decide whether it already
    // carries these variables.
    envWrittenAt:
      created + updated > 0
        ? new Date(deps.now()).toISOString()
        : state.envWrittenAt,
  });

  if (created + updated === 0) {
    return { status: "skipped", detail: `all 3 variables already correct` };
  }
  return {
    status: "done",
    detail: `${created} created, ${updated} updated, ${skipped} unchanged`,
  };
}

// ---- trigger-redeploy -----------------------------------------
//
// Environment variables only take effect on a new deployment. The
// running production build read its variables when it was built; a
// variable written afterwards is invisible to it.
//
// Skips when the current production deployment is already newer than
// the last env write, which is the rerun case and the common one.

async function triggerRedeploy(
  ctx: ProvisionContext,
  deps: ProvisionDeps
): Promise<StepResult> {
  const state = deps.readState(ctx.subdomain);
  const latest = await deps.vercel.latestProductionDeployment();

  if (!latest) {
    throw new Error(
      "The Vercel project has no production deployment to redeploy from."
    );
  }

  const latestCreated = latest.created ?? latest.createdAt ?? 0;
  const envWrittenAt = state?.envWrittenAt
    ? Date.parse(state.envWrittenAt)
    : null;
  const latestId = latest.uid ?? latest.id;

  if (
    envWrittenAt !== null &&
    latestCreated > envWrittenAt &&
    (latest.readyState ?? latest.state) === DEPLOYMENT_READY
  ) {
    return {
      status: "skipped",
      detail: `production deployment ${latestId} already postdates the env write`,
    };
  }

  const project = await deps.vercel.getProject();
  deps.log(`      redeploying ${project.name} from ${latestId}…`);
  const deployment = await deps.vercel.redeploy({
    name: project.name,
    deploymentId: latestId as string,
  });
  const newId = (deployment.uid ?? deployment.id) as string;

  try {
    await waitForDeployment({
      id: newId,
      getState: async () => {
        const current = await deps.vercel.getDeployment(newId);
        return current.readyState ?? current.state ?? "UNKNOWN";
      },
      now: deps.now,
      sleep: deps.sleep,
      onTick: (st, elapsed) =>
        deps.log(`      ${Math.round(elapsed / 1000)}s — ${st}`),
    });
  } catch (error) {
    if (error instanceof DeploymentFailedError) {
      throw new Error(
        `${error.message} Production is still serving the previous ` +
          `deployment, so nothing is down — but the new variables are ` +
          `not live. Check the build log in Vercel.`
      );
    }
    if (error instanceof DeploymentTimeoutError) {
      throw new Error(
        `${error.message} It may still finish; rerunning picks up from ` +
          `whatever state it reaches.`
      );
    }
    throw error;
  }

  deps.writeState(ctx.subdomain, { deploymentId: newId });
  return { status: "done", detail: `redeployed — ${newId} is READY` };
}

// ---- verify-instance ------------------------------------------
//
// GROUNDWORK, and the assertion is deliberately inverted from where it
// ends up.
//
// Right now insert-registry-row is still a stub, so there is no
// registry row and the hostname MUST resolve to nothing. Requiring the
// not-found page proves three things at once: the wildcard DNS and
// certificate cover this subdomain, the redeploy that just went out
// did not break the running site, and the instance is correctly not
// yet reachable.
//
// When insert-registry-row lands, this assertion flips: the same URL
// must then serve a sign-in page. Change it there, in that step's
// change, so the two move together.

const NOT_FOUND_MARKER = "no AiMS Higher instance";

async function verifyInstance(
  ctx: ProvisionContext,
  deps: ProvisionDeps
): Promise<StepResult> {
  const url = `https://${ctx.subdomain}.aims-hq.com/sign-in`;
  deps.log(`      GET ${url}`);

  const response = await deps.httpGet(url);
  if (response.status !== 200) {
    throw new Error(
      `${url} returned ${response.status}. The wildcard DNS or the ` +
        `certificate may not cover this subdomain yet.`
    );
  }

  const isNotFound = response.body.includes(NOT_FOUND_MARKER);
  if (!isNotFound) {
    throw new Error(
      `${url} served something other than the no-instance page. That ` +
        `is expected only once insert-registry-row is implemented and ` +
        `has run — until then a resolvable hostname means a registry ` +
        `row exists that provisioning did not write.`
    );
  }

  return {
    status: "done",
    detail:
      "wildcard serves the subdomain, and it correctly resolves to no " +
      "instance (the registry row is still a later step)",
  };
}

export const PROVISION_STEPS: readonly ProvisionStep[] = [
  {
    name: "check-preconditions",
    describe: (c) =>
      `confirm "${c.subdomain}" is free in the registry and no ${c.envPrefix}_SUPABASE_* variables already exist`,
    execute: stub(
      (c) =>
        `look up "${c.subdomain}" in public.instances and check Vercel for ${c.envPrefix}_SUPABASE_URL`
    ),
  },
  {
    name: "create-supabase-project",
    describe: (c) =>
      `create the Supabase project ${projectNameFor(c.subdomain)} in ${c.region}, or adopt it if it already exists`,
    execute: createSupabaseProject,
  },
  {
    name: "apply-migrations",
    describe: () =>
      "apply supabase/migrations with `supabase db push`, the same command db-push.sh uses",
    execute: applyMigrations,
  },
  {
    name: "seed-data",
    describe: () =>
      "run supabase/seed/instance-seed.sql — the reference data a new instance cannot start without",
    execute: seedData,
  },
  // DEFERRED VERIFICATION, to be done when this step is implemented.
  //
  // apply-migrations has never been watched applying migrations from
  // nothing. The push path was exercised by running the identical
  // `supabase db push --db-url … --include-all` against provtest1
  // directly, which applied all 90; by the time the step itself ran
  // there was nothing pending and it correctly reported "skipped". So
  // the orchestration around the command — pending detection,
  // connection string, post-push verification, state write — is
  // covered by unit tests and not by a real run.
  //
  // Rather than create a second project just to close that, fold it
  // into this step's testing: tear provtest1 down, then run the full
  // command once against a fresh provtest2. That single run proves the
  // migration orchestration applying every pending migration from an
  // empty database, and exercises this step at the same time. Tear
  // provtest2 down afterwards by the same teardown procedure.
  //
  // Prerequisite: that teardown procedure is not written yet. It needs
  // to exist before provtest1 is deleted, or the second project
  // becomes another thing left running that nobody remembers.
  {
    name: "write-vercel-env",
    describe: (c) =>
      `write ${c.envPrefix}_SUPABASE_URL / _ANON_KEY / _SERVICE_KEY to Vercel Production (service key sensitive)`,
    execute: writeVercelEnv,
  },
  {
    name: "trigger-redeploy",
    describe: () => "redeploy production so the new variables take effect",
    execute: triggerRedeploy,
  },
  {
    name: "insert-registry-row",
    describe: (c) =>
      `register "${c.subdomain}" → env_prefix ${c.envPrefix} (this is what makes the hostname resolve)`,
    execute: stub(
      (c) =>
        `insert { subdomain: "${c.subdomain}", env_prefix: "${c.envPrefix}", status: "active" } into public.instances`
    ),
  },
  {
    name: "create-admin",
    describe: (c) => `create ${c.adminEmail} as the company_admin and invite them`,
    execute: stub(
      (c) => `create ${c.adminEmail} in the new project and send an invitation`
    ),
  },
  {
    name: "verify-instance",
    describe: (c) =>
      `confirm https://${c.subdomain}.aims-hq.com is served and, for now, resolves to no instance`,
    execute: verifyInstance,
  },
];

// The order, as data, so a test can pin it without reaching into the
// step objects.
export const STEP_NAMES: readonly string[] = PROVISION_STEPS.map((s) => s.name);
