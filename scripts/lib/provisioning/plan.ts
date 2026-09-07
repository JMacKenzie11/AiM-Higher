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
  generateDbPassword,
  pickApiKeys,
  type InstanceState,
} from "./state.ts";

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
  // Reads and writes .provisioning-state/{subdomain}.json.
  readState: (subdomain: string) => InstanceState | null;
  writeState: (subdomain: string, patch: Partial<InstanceState>) => InstanceState;
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
    describe: () => "apply supabase/migrations to the new project",
    execute: stub(() => "run every migration in supabase/migrations in order"),
  },
  {
    name: "seed-data",
    describe: () => "seed the reference data a new instance cannot start without",
    execute: stub(() => "insert the baseline rows a fresh instance needs"),
  },
  {
    name: "write-vercel-env",
    describe: (c) =>
      `write ${c.envPrefix}_SUPABASE_URL / _ANON_KEY / _SERVICE_KEY to Vercel`,
    execute: stub(
      (c) =>
        `PATCH the Vercel project with ${c.envPrefix}_SUPABASE_URL, ${c.envPrefix}_SUPABASE_ANON_KEY and ${c.envPrefix}_SUPABASE_SERVICE_KEY on Production`
    ),
  },
  {
    name: "trigger-redeploy",
    describe: () => "redeploy so the running app can read the new variables",
    execute: stub(
      () => "trigger a Vercel production deployment and wait for it to finish"
    ),
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
    describe: (c) => `confirm ${c.subdomain} resolves and serves a sign-in page`,
    execute: stub(
      (c) =>
        `request https://${c.subdomain}.aims-hq.com/sign-in and assert it is not the no-instance page`
    ),
  },
];

// The order, as data, so a test can pin it without reaching into the
// step objects.
export const STEP_NAMES: readonly string[] = PROVISION_STEPS.map((s) => s.name);
