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
  projectNameFor,
  waitForHealthy,
  type ManagementClient,
  type ManagementProject,
} from "./supabase-management.ts";
import {
  MIGRATIONS_TABLE,
  applyPendingMigrations,
} from "./migrate.ts";
import {
  generateDbPassword,
  fingerprint,
  pickApiKeys,
  type InstanceState,
} from "./state.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createCompany } from "@/lib/companies/create-company";
import {
  createPendingUser,
  generateAcceptLink,
} from "@/lib/auth/provision-user";
import {
  DEPLOYMENT_READY,
  DeploymentFailedError,
  DeploymentTimeoutError,
  planEnvVar,
  waitForDeployment,
  type VercelClient,
  type VercelEnvType,
} from "./vercel.ts";

// Re-exported from its new home so existing importers are unaffected.
export { migrationVersion } from "./migrate.ts";

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
  // Upserts a row into the control plane's public.instances. Injected
  // rather than a Supabase client, so the step is testable and so
  // nothing here can reach the control plane for anything else.
  // The new instance's own admin client. Built from the state file's
  // URL and service key, so it points at the instance being created
  // and not at whatever the provisioning machine's env says.
  instanceAdminClient: (state: InstanceState) => SupabaseClient;
  // Sends the invitation email. Returns ok:false when Resend is not
  // configured, which is the normal case from a script.
  sendInvite: (input: {
    to: string;
    firstName: string | null;
    actionLink: string;
  }) => Promise<{ ok: boolean; message?: string }>;
  getRegistryRow: (subdomain: string) => Promise<{
    subdomain: string;
    env_prefix: string;
    status: string;
  } | null>;
  upsertRegistryRow: (row: {
    subdomain: string;
    display_name: string;
    env_prefix: string;
    status: string;
  }) => Promise<void>;
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

// Every step is implemented; the stub helper that stood in for the
// unimplemented ones is gone with the last of them.

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
// The work itself lives in migrate.ts, shared with
// scripts/migrate-instances.ts, which walks every registered instance.
// One implementation on purpose: two would drift, and the way they
// would drift is a release that reaches some instances and not others
// with nothing saying which.
//
// db push is idempotent by design — it consults the remote
// supabase_migrations.schema_migrations table — so a rerun is safe.
// This step reports "skipped" when the comparison finds nothing
// pending, rather than shelling out to be told so.

async function appliedVersionsFor(
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

  const outcome = await applyPendingMigrations({
    ref: state.projectRef,
    password: state.dbPassword,
    // Only looked up when there is something to push.
    poolerHost: async () => {
      const pooler = await deps.management.getPoolerConfig(
        state.projectRef as string
      );
      const host = pooler[0]?.db_host;
      if (!host) {
        throw new Error(
          `Project ${state.projectRef} reported no pooler host, so there ` +
            "is no IPv4-reachable way in. Check the project's database settings."
        );
      }
      return host;
    },
    localMigrations: deps.localMigrations(),
    appliedVersions: () => appliedVersionsFor(state.projectRef as string, deps),
    runCommand: deps.runCommand,
    log: (line) => deps.log(`      ${line}`),
  });

  if (outcome.version) {
    deps.writeState(ctx.subdomain, { migrationVersion: outcome.version });
  }

  if (outcome.status === "up-to-date") {
    return {
      status: "skipped",
      detail: `already at ${outcome.version ?? "no migrations"}`,
    };
  }
  return {
    status: "done",
    detail: `applied ${outcome.applied.length} migrations, now at ${outcome.version}`,
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
// The assertion is now the right way round.
//
// Until insert-registry-row was implemented this required the
// no-instance page, because that was the correct state. The registry
// row now exists by the time this runs, so the hostname must serve the
// app — and this is the only step that checks the thing a customer
// will actually do.
//
// It polls, because the registry lookup is cached per process for 60
// seconds (CACHE_TTL_MS in src/lib/instances/registry.ts) and misses
// are cached too. A serverless instance that answered before the row
// landed will keep saying "no instance here" until its entry expires.
// Waiting that out is the difference between "provisioning failed" and
// "you were sixteen seconds early".

const NOT_FOUND_MARKER = "no AiMS Higher instance";
const REGISTRY_CACHE_TTL_MS = 60 * 1000;

async function verifyInstance(
  ctx: ProvisionContext,
  deps: ProvisionDeps
): Promise<StepResult> {
  const base = `https://${ctx.subdomain}.aims-hq.com`;
  const url = `${base}/sign-in`;
  deps.log(`      polling ${url} (up to 60s for the registry cache)…`);

  const started = deps.now();
  let lastStatus = 0;
  let body = "";

  for (;;) {
    const response = await deps.httpGet(url);
    lastStatus = response.status;
    body = response.body;
    const elapsed = deps.now() - started;

    if (response.status === 200 && !body.includes(NOT_FOUND_MARKER)) {
      deps.log(`      resolved after ${Math.round(elapsed / 1000)}s`);
      break;
    }

    if (elapsed >= REGISTRY_CACHE_TTL_MS + 10_000) {
      if (body.includes(NOT_FOUND_MARKER)) {
        throw new Error(
          `${url} still serves the no-instance page after ` +
            `${Math.round(elapsed / 1000)}s. The registry row exists, so ` +
            `either its ${ctx.envPrefix}_SUPABASE_* variables are missing ` +
            `from Vercel Production, or the deployment reading them ` +
            `predates the env write.`
        );
      }
      throw new Error(`${url} returned ${lastStatus} after ${Math.round(elapsed / 1000)}s.`);
    }

    deps.log(`      ${Math.round(elapsed / 1000)}s — not resolved yet`);
    await deps.sleep(5_000);
  }

  // Resolving is not the same as working. The sign-in form is the
  // first thing a real person touches, so check it rendered.
  const looksLikeSignIn = /type="password"|name="password"/i.test(body);
  if (!looksLikeSignIn) {
    throw new Error(
      `${url} resolved to an instance but did not render a sign-in ` +
        `form. The hostname is live and the app behind it is not.`
    );
  }

  deps.writeState(ctx.subdomain, { verifiedAt: new Date(deps.now()).toISOString() });
  return { status: "done", detail: `${base} serves the sign-in page` };
}


// ---- insert-registry-row --------------------------------------
//
// THE SWITCH. Everything before this builds an instance nobody can
// reach; this row is what makes the hostname resolve, and from the
// moment it lands the subdomain serves the app to anyone who visits.
//
// That is why it is second-to-last rather than early: a row written
// before the database is migrated and seeded publishes a broken
// instance to real traffic, and the failure looks like a customer
// signing in to something half-built.
//
// It is written to the CONTROL PLANE, not to the new instance. Every
// project has an instances table because the migrations create one;
// only the control plane's copy is ever read.

async function insertRegistryRow(
  ctx: ProvisionContext,
  deps: ProvisionDeps
): Promise<StepResult> {
  const state = deps.readState(ctx.subdomain);
  if (!state?.projectRef) {
    throw new Error(
      `No project in .provisioning-state/${ctx.subdomain}.json. ` +
        "Refusing to publish a hostname with no database behind it."
    );
  }
  // The variables the row points at have to exist before the row does,
  // or the instance resolves to null and looks like an unknown host.
  if (!state.envWrittenAt) {
    throw new Error(
      `${ctx.envPrefix}_SUPABASE_* has not been written to Vercel yet. ` +
        "A registry row naming variables that do not exist resolves to " +
        "nothing, which is indistinguishable from an unregistered hostname."
    );
  }

  await deps.upsertRegistryRow({
    subdomain: ctx.subdomain,
    display_name: ctx.displayName,
    env_prefix: ctx.envPrefix,
    status: "active",
  });

  deps.writeState(ctx.subdomain, { registeredAt: new Date(deps.now()).toISOString() });
  return {
    status: "done",
    detail: `"${ctx.subdomain}" → env_prefix ${ctx.envPrefix} (active) — the hostname is live`,
  };
}


// ---- create-admin ---------------------------------------------
//
// The instance's first company and the person who will run it.
//
// Both go through the app's own code — createCompany() and
// createPendingUser()/generateAcceptLink() — rather than a second
// implementation here. Those were extracted from the server actions
// for exactly this: a script that reimplemented "what a new company
// gets" would drift from the app the first time a default changed, and
// the drift would be invisible until an instance behaved differently
// from every other one.
//
// THE ADMIN IS A system_admin, with no company. Every provisioned
// instance gets one, deliberately: the instance needs somebody who can
// see across companies before any company exists. They scope into the
// first company the same way they would into any other.
//
// The invite is the normal flow — a magic link to /accept-invite where
// they set their own password. No password is generated or printed. If
// Resend is not configured, which is the usual case from a script, the
// link is printed once instead and the summary says so, because a link
// nobody received is worse than one printed to a terminal.

async function createAdmin(
  ctx: ProvisionContext,
  deps: ProvisionDeps
): Promise<StepResult> {
  const state = deps.readState(ctx.subdomain);
  if (!state?.apiUrl || !state.serviceKey) {
    throw new Error(
      `.provisioning-state/${ctx.subdomain}.json has no URL or service key. ` +
        "Run create-supabase-project first."
    );
  }

  const admin = deps.instanceAdminClient(state);
  const instanceUrl = `https://${ctx.subdomain}.aims-hq.com`;

  // ---- The first company --------------------------------------
  const { data: companies } = await admin
    .from("companies")
    .select("id, name")
    .limit(1);

  let companyId: string;
  if (companies && companies.length > 0) {
    companyId = (companies[0] as { id: string }).id;
    deps.log(`      company already exists (${companyId})`);
  } else {
    // Only the name is supplied. Features, chart roots and the opening
    // quarter are createCompany's decisions — see the boundary note in
    // lib/companies/create-company.ts.
    const created = await createCompany(admin, { name: ctx.displayName });
    if (!created.ok) throw new Error(`Company creation failed: ${created.message}`);
    companyId = created.company.id;
    deps.log(`      created company "${ctx.displayName}" (${companyId})`);
  }

  // ---- The admin ----------------------------------------------
  const { data: existingProfiles } = await admin
    .from("profiles")
    .select("id, role, status")
    .eq("role", "system_admin")
    .limit(1);

  if (existingProfiles && existingProfiles.length > 0) {
    const row = existingProfiles[0] as { id: string; status: string };
    deps.writeState(ctx.subdomain, {
      adminEmail: ctx.adminEmail,
      companyId,
    });
    return {
      status: "skipped",
      detail: `system_admin already exists (${row.id}, ${row.status})`,
    };
  }

  const user = await createPendingUser({
    admin,
    email: ctx.adminEmail,
    fullName: ctx.adminEmail.split("@")[0] ?? ctx.adminEmail,
    role: "system_admin",
    // A system_admin belongs to no company; they scope into one.
    companyId: null,
  });
  if (!user.ok) throw new Error(`Admin creation failed: ${user.message}`);

  const link = await generateAcceptLink({
    admin,
    // The INSTANCE's URL, not the provisioning machine's. This is the
    // parameter that made the extraction necessary.
    appUrl: instanceUrl,
    email: ctx.adminEmail,
  });
  if (!link.ok) throw new Error(`Invite link failed: ${link.message}`);

  const sent = await deps.sendInvite({
    to: ctx.adminEmail,
    firstName: null,
    actionLink: link.link,
  });

  let method: string;
  if (sent.ok) {
    method = "emailed";
    deps.log(`      invitation emailed to ${ctx.adminEmail}`);
  } else {
    method = "link printed";
    deps.log(`      email not sent (${sent.message ?? "no mailer"}).`);
    deps.log(`      invitation link, shown once:`);
    deps.log(`        ${link.link}`);
  }

  deps.writeState(ctx.subdomain, {
    adminEmail: ctx.adminEmail,
    adminInviteMethod: method,
    companyId,
  });

  return {
    status: "done",
    detail: `system_admin ${ctx.adminEmail} created, invitation ${method}`,
  };
}


// ---- check-preconditions --------------------------------------
//
// Everything that can be known cheaply, before ten minutes of API
// calls discovers it the expensive way.
//
// Each check answers a question that would otherwise surface as a
// confusing failure several steps in: a bad Vercel token as a 403 at
// step 5, after a Supabase project has already been created and
// billed; a subdomain already registered to another instance as a
// silent takeover at step 7; missing wildcard DNS as a verification
// failure at step 9, with everything else already built.
//
// It fails on the first problem rather than collecting them, because
// the second one is usually a consequence of the first.

async function checkPreconditions(
  ctx: ProvisionContext,
  deps: ProvisionDeps
): Promise<StepResult> {
  const checks: string[] = [];

  // 1. The Supabase management token actually works. Config presence
  //    was checked before the plan printed; this checks it is valid.
  try {
    await deps.management.listProjects();
    checks.push("supabase management token");
  } catch (error) {
    throw new Error(
      `SUPABASE_MANAGEMENT_TOKEN was rejected: ${
        error instanceof Error ? error.message.split("\n")[0] : String(error)
      }`
    );
  }

  // 2. The Vercel project exists and the token can see it. Both come
  //    from .env.provisioning and either can be wrong independently.
  let projectName: string;
  try {
    projectName = (await deps.vercel.getProject()).name;
    checks.push(`vercel project "${projectName}"`);
  } catch (error) {
    throw new Error(
      `VERCEL_TOKEN / VERCEL_PROJECT_ID rejected: ${
        error instanceof Error ? error.message.split("\n")[0] : String(error)
      }`
    );
  }

  // 3. The control plane answers, and this subdomain is either free or
  //    already ours. A row pointing somewhere else is the dangerous
  //    case: provisioning would overwrite it at step 7 and silently
  //    repoint a live hostname at a different database.
  const existing = await deps.getRegistryRow(ctx.subdomain);
  if (existing && existing.env_prefix !== ctx.envPrefix) {
    throw new Error(
      `"${ctx.subdomain}" is already registered to env_prefix ` +
        `${existing.env_prefix}, not ${ctx.envPrefix}. Continuing would ` +
        `repoint a live hostname at a different database. Delete the row ` +
        `first if that is really what you want.`
    );
  }
  checks.push(
    existing ? `registry row exists (rerun)` : "subdomain free in the registry"
  );

  // 4. The wildcard covers this subdomain. Any HTTP answer proves DNS
  //    and the certificate; whether it is the app or the no-instance
  //    page is step 9's business, not this one's.
  const hostname = `${ctx.subdomain}.aims-hq.com`;
  try {
    const response = await deps.httpGet(`https://${hostname}/sign-in`);
    if (response.status >= 500) {
      throw new Error(`returned ${response.status}`);
    }
    checks.push(`wildcard serves ${hostname}`);
  } catch (error) {
    throw new Error(
      `https://${hostname} is not reachable (${
        error instanceof Error ? error.message : String(error)
      }). The wildcard DNS record or its certificate does not cover this ` +
        `subdomain, and step 9 would fail after everything else was built.`
    );
  }

  for (const check of checks) deps.log(`      ok — ${check}`);
  return { status: "done", detail: `${checks.length} checks passed` };
}

export const PROVISION_STEPS: readonly ProvisionStep[] = [
  {
    name: "check-preconditions",
    describe: (c) =>
      `verify the tokens work, "${c.subdomain}" is free in the registry, and the wildcard covers it`,
    execute: checkPreconditions,
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
      `register "${c.subdomain}" → env_prefix ${c.envPrefix} in the control plane — the switch that makes the hostname live`,
    execute: insertRegistryRow,
  },
  {
    name: "create-admin",
    describe: (c) =>
      `create the first company "${c.displayName}" and invite ${c.adminEmail} as its system_admin`,
    execute: createAdmin,
  },
  {
    name: "verify-instance",
    describe: (c) =>
      `poll https://${c.subdomain}.aims-hq.com until it serves the app, then confirm the sign-in page renders`,
    execute: verifyInstance,
  },
];

// The order, as data, so a test can pin it without reaching into the
// step objects.
export const STEP_NAMES: readonly string[] = PROVISION_STEPS.map((s) => s.name);
