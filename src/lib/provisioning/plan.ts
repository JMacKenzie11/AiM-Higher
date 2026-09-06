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

export type ProvisionStep = {
  // Stable identifier. Tests pin the order by these.
  name: string;
  // What this step does, in one line, with the context resolved.
  describe: (ctx: ProvisionContext) => string;
  execute: (ctx: ProvisionContext) => Promise<StepResult>;
};

function stub(what: (ctx: ProvisionContext) => string) {
  return async (ctx: ProvisionContext): Promise<StepResult> => ({
    status: "done",
    detail: `stub — would ${what(ctx)}`,
  });
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
    describe: (c) => `create a Supabase project in ${c.region}`,
    execute: stub(
      (c) => `POST the Supabase Management API to create a project in ${c.region}`
    ),
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
