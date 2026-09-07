import { migrationConnectionUrl } from "./supabase-management.ts";
import type { InstanceState } from "./state.ts";

// Applying pending migrations to one database.
//
// Shared by the provisioning CLI's apply-migrations step and by
// scripts/migrate-instances.ts, which walks every registered instance.
// One implementation on purpose: two would drift, and the way they
// would drift is a release that reaches some instances and not others,
// with nothing saying which.

export const MIGRATIONS_TABLE = "supabase_migrations.schema_migrations";

// A migration filename is 0169_instances.sql; the version db push
// records is the numeric prefix.
export function migrationVersion(filename: string): string {
  return filename.split("_")[0] ?? filename;
}

export function pendingMigrations(
  local: readonly string[],
  applied: ReadonlySet<string>
): string[] {
  return local.filter((f) => !applied.has(migrationVersion(f)));
}

export function latestVersion(local: readonly string[]): string | null {
  return local.length > 0 ? migrationVersion(local[local.length - 1]) : null;
}

export type MigrationOutcome =
  | { status: "applied"; applied: string[]; version: string | null }
  | { status: "up-to-date"; version: string | null };

export type RunCommand = (
  command: string,
  args: string[]
) => Promise<{ code: number; stdout: string; stderr: string }>;

export async function applyPendingMigrations(opts: {
  ref: string;
  password: string;
  // Resolved only when there is something to push. Looking it up
  // otherwise is one API call per instance per run to learn nothing,
  // which is free at two instances and not at fifty.
  poolerHost: () => Promise<string>;
  localMigrations: readonly string[];
  // Reads the remote migrations table. Returns an empty set when the
  // table does not exist yet, which is "nothing applied", not an error.
  appliedVersions: () => Promise<Set<string>>;
  runCommand: RunCommand;
  log: (line: string) => void;
}): Promise<MigrationOutcome> {
  const applied = await opts.appliedVersions();
  const pending = pendingMigrations(opts.localMigrations, applied);
  const version = latestVersion(opts.localMigrations);

  if (pending.length === 0) {
    return { status: "up-to-date", version };
  }

  const dbUrl = migrationConnectionUrl({
    poolerHost: await opts.poolerHost(),
    ref: opts.ref,
    password: opts.password,
  });

  opts.log(`${pending.length} pending, pushing…`);
  const result = await opts.runCommand("supabase", [
    "db",
    "push",
    "--db-url",
    dbUrl,
    "--include-all",
  ]);

  if (result.code !== 0) {
    // The CLI explains itself in its own output. The connection string
    // is deliberately not echoed — it carries the password.
    throw new Error(
      `supabase db push exited ${result.code}.\n${(result.stderr || result.stdout).trim()}`
    );
  }

  // Exit code 0 is the CLI's claim; the remote table is the fact.
  const after = await opts.appliedVersions();
  const stillPending = pendingMigrations(opts.localMigrations, after);
  if (stillPending.length > 0) {
    throw new Error(
      `supabase db push reported success but ${stillPending.length} ` +
        `migrations are still missing remotely, starting with ${stillPending[0]}.`
    );
  }

  return { status: "applied", applied: pending, version };
}

// ---- Which database is an instance, and how do we get in ------

export type RegistryRow = {
  subdomain: string;
  display_name?: string;
  env_prefix: string;
  status: string;
};

export type InstanceTarget =
  | { ok: true; subdomain: string; envPrefix: string; ref: string; password: string }
  | { ok: false; subdomain: string; envPrefix: string; reason: string };

// The project ref, taken from the variables the registry row points
// at rather than from anywhere else. That is what the running app
// resolves through, so it is the authoritative answer to "which
// database is this instance".
export function refFromSupabaseUrl(url: string): string | null {
  const match = url.match(/^https?:\/\/([a-z0-9]+)\.supabase\.co/i);
  return match ? match[1] : null;
}

// The primary instance is the one the app itself runs on. It was not
// created by provisioning, so it has no state file and therefore no
// recorded database password.
export const PRIMARY_ENV_PREFIX = "PROD";
export const PRIMARY_PASSWORD_VAR = "PROD_DATABASE_PASSWORD";

export function resolveTarget(args: {
  row: RegistryRow;
  env: Record<string, string | undefined>;
  readState: (subdomain: string) => InstanceState | null;
}): InstanceTarget {
  const { row, env } = args;
  const envPrefix = row.env_prefix;

  // The primary instance predates the provisioning CLI, so it has no
  // state file. Both its ref and its password come from the
  // environment instead.
  if (envPrefix === PRIMARY_ENV_PREFIX) {
    const url = env[`${PRIMARY_ENV_PREFIX}_SUPABASE_URL`];
    const ref = url ? refFromSupabaseUrl(url) : null;
    if (!ref) {
      return {
        ok: false,
        subdomain: row.subdomain,
        envPrefix,
        reason:
          `${PRIMARY_ENV_PREFIX}_SUPABASE_URL is not set in ` +
          `.env.provisioning, or is not a Supabase project URL.`,
      };
    }
    const password = env[PRIMARY_PASSWORD_VAR];
    if (!password) {
      return {
        ok: false,
        subdomain: row.subdomain,
        envPrefix,
        reason:
          `${PRIMARY_PASSWORD_VAR} is not set in .env.provisioning. The ` +
          `primary instance has no .provisioning-state file because it ` +
          `was not created by the provisioning CLI, and Supabase never ` +
          `shows a database password twice — so if nobody has it, reset ` +
          `it under Project Settings → Database and put it there.`,
      };
    }
    return { ok: true, subdomain: row.subdomain, envPrefix, ref, password };
  }

  // Every provisioned instance records its own ref and password when
  // it is built. Deliberately NOT read from {PREFIX}_SUPABASE_URL: the
  // whole point of the registry is that those variables live in
  // Vercel, and requiring a local copy of every instance's URL would
  // be a second source of truth that drifts the first time one is
  // rotated without anyone updating this machine.
  const state = args.readState(row.subdomain);
  if (!state?.projectRef || !state.dbPassword) {
    const missing = !state
      ? "is missing"
      : !state.projectRef
        ? "has no projectRef"
        : "has no dbPassword";
    return {
      ok: false,
      subdomain: row.subdomain,
      envPrefix,
      reason:
        `.provisioning-state/${row.subdomain}.json ${missing}. That file ` +
        `is written when an instance is provisioned and is the only ` +
        `record of its database password — Supabase never shows one ` +
        `twice. Without it this instance has to be migrated by hand, or ` +
        `its password reset in the Supabase dashboard and written back.`,
    };
  }

  return {
    ok: true,
    subdomain: row.subdomain,
    envPrefix,
    ref: state.projectRef,
    password: state.dbPassword,
  };
}

// ---- Walking every instance -----------------------------------

export type InstanceResult = {
  subdomain: string;
  envPrefix: string;
} & (
  | { status: "applied"; applied: string[]; version: string | null }
  | { status: "up-to-date"; version: string | null }
  | { status: "would-apply"; pending: string[]; version: string | null }
  | { status: "blocked"; reason: string }
  | { status: "failed"; reason: string }
);

export function isProblem(result: InstanceResult): boolean {
  return result.status === "blocked" || result.status === "failed";
}

// Migrates every instance, in sequence, and never stops early.
//
// SEQUENTIAL ON PURPOSE. These are separate databases and could run in
// parallel, but the output of a parallel run interleaves into
// something nobody can read at the moment they most need to — and this
// tool runs immediately before a code deploy, when knowing exactly
// which instance failed is the whole point.
//
// A failure on one instance is recorded and the loop continues. The
// alternative leaves the remaining instances in an unknown state,
// which is worse than a known-bad one: the operator would have to work
// out where the loop stopped before they could work out what to do.
export async function migrateAllInstances(opts: {
  rows: readonly RegistryRow[];
  env: Record<string, string | undefined>;
  readState: (subdomain: string) => InstanceState | null;
  localMigrations: readonly string[];
  poolerHostFor: (ref: string) => Promise<string>;
  appliedVersionsFor: (ref: string) => Promise<Set<string>>;
  runCommand: RunCommand;
  log: (line: string) => void;
  dryRun?: boolean;
}): Promise<InstanceResult[]> {
  const results: InstanceResult[] = [];

  for (const row of opts.rows) {
    const target = resolveTarget({
      row,
      env: opts.env,
      readState: opts.readState,
    });

    if (!target.ok) {
      opts.log(`  ${row.subdomain}: BLOCKED — ${target.reason}`);
      results.push({
        subdomain: target.subdomain,
        envPrefix: target.envPrefix,
        status: "blocked",
        reason: target.reason,
      });
      continue;
    }

    try {
      if (opts.dryRun) {
        const applied = await opts.appliedVersionsFor(target.ref);
        const pending = pendingMigrations(opts.localMigrations, applied);
        const version = latestVersion(opts.localMigrations);
        const current = [...applied].sort().pop() ?? "none";
        opts.log(
          pending.length === 0
            ? `  ${target.subdomain}: up to date at ${current}`
            : `  ${target.subdomain}: at ${current}, would apply ${pending.length} → ${version}`
        );
        results.push({
          subdomain: target.subdomain,
          envPrefix: target.envPrefix,
          status: pending.length === 0 ? "up-to-date" : "would-apply",
          ...(pending.length === 0 ? { version } : { pending, version }),
        } as InstanceResult);
        continue;
      }

      const outcome = await applyPendingMigrations({
        ref: target.ref,
        password: target.password,
        // Lazy: an instance that is already up to date never asks.
        poolerHost: () => opts.poolerHostFor(target.ref),
        localMigrations: opts.localMigrations,
        appliedVersions: () => opts.appliedVersionsFor(target.ref),
        runCommand: opts.runCommand,
        log: (line) => opts.log(`  ${target.subdomain}: ${line}`),
      });

      if (outcome.status === "up-to-date") {
        opts.log(`  ${target.subdomain}: up to date at ${outcome.version}`);
        results.push({
          subdomain: target.subdomain,
          envPrefix: target.envPrefix,
          status: "up-to-date",
          version: outcome.version,
        });
      } else {
        opts.log(
          `  ${target.subdomain}: applied ${outcome.applied.length} → ${outcome.version}`
        );
        results.push({
          subdomain: target.subdomain,
          envPrefix: target.envPrefix,
          status: "applied",
          applied: outcome.applied,
          version: outcome.version,
        });
      }
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : String(error);
      opts.log(`  ${target.subdomain}: FAILED — ${reason.split("\n")[0]}`);
      results.push({
        subdomain: target.subdomain,
        envPrefix: target.envPrefix,
        status: "failed",
        reason,
      });
    }
  }

  return results;
}
