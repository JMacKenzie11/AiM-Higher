/**
 * scripts/migrate-instances.ts
 *
 * Applies pending migrations to every active instance in the registry.
 *
 * Usage:
 *   npm run migrate:instances                    # every active instance
 *   npm run migrate:instances -- --dry-run
 *   npm run migrate:instances -- --seed          # migrate, then top up seed data
 *   npm run migrate:instances -- --db-url "<url>"  # one off-registry database
 *
 * --seed also runs supabase/seed/instance-seed.sql against each
 * instance after its migrations. The seed is idempotent by
 * construction, so this is safe to repeat; its purpose is delivering
 * reference data ADDED since an instance was built, which migrations
 * do not carry. Off by default because reference data changes far
 * less often than schema does, and a flag you have to type is a flag
 * you thought about.
 *
 * Suspended instances are skipped and reported as skipped. See the
 * status contract in src/lib/instances/types.ts.
 *
 * --db-url migrates a single database that is not in the registry. The
 * dev clone is the case it exists for: it is disposable tooling rather
 * than a live instance, so it has no registry row — registry rows are
 * switches that make a hostname serve customers, and the clone is not
 * one. This keeps it on the same code path rather than leaving an
 * orphan script that writes no migration history.
 *
 * Run this BEFORE promoting a code deploy, not after. See the deploy
 * order rule in scripts/README.md: the app deploys once for every
 * instance while databases migrate one at a time, so a migration that
 * only the new code can live with breaks every instance that has not
 * been reached yet.
 *
 * Config comes from .env.provisioning and nowhere else, the same rule
 * provisioning follows — .env.local's CONTROL_PLANE_* get repointed at
 * the dev clone during local testing, and inheriting those here would
 * migrate the wrong databases.
 */

import { spawn } from "node:child_process";
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { argv } from "node:process";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import {
  MIGRATIONS_TABLE,
  isProblem,
  migrateAllInstances,
  selectMigratableRows,
  type InstanceResult,
  type RegistryRow,
} from "./lib/provisioning/migrate.ts";
import { createManagementClient } from "./lib/provisioning/supabase-management.ts";
import { stateFileFor, type InstanceState } from "./lib/provisioning/state.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const SEED_FILE = "supabase/seed/instance-seed.sql";

try {
  process.loadEnvFile(".env.provisioning");
} catch {
  // Missing values are reported by name below.
}

function fail(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

const REQUIRED = [
  "CONTROL_PLANE_SUPABASE_URL",
  "CONTROL_PLANE_SUPABASE_SERVICE_KEY",
  "SUPABASE_MANAGEMENT_TOKEN",
];

function readStateFile(subdomain: string): InstanceState | null {
  try {
    return JSON.parse(readFileSync(stateFileFor(subdomain), "utf8")) as InstanceState;
  } catch {
    return null;
  }
}

function runCommand(
  command: string,
  args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

// The summary, as an array of lines.
//
// Split out from printing so it can be asserted directly. This output
// is the interface someone reads during an incident, and it has
// already been wrong once: the alias string was computed and never
// interpolated, so a database shared by two registry rows reported as
// one with no indication. Tests over the result objects did not catch
// that, because the objects were right and the rendering was not.
export function summaryLines(
  results: InstanceResult[],
  skipped: Array<{ subdomain: string; status: string }> = []
): string[] {
  const width = Math.max(
    9,
    ...results.map((r) => r.subdomain.length),
    ...skipped.map((r) => r.subdomain.length)
  );
  const lines: string[] = [];
  for (const r of results) {
    const name = r.subdomain.padEnd(width);
    const alias =
      r.aliases && r.aliases.length > 0
        ? `  (also ${r.aliases.join(", ")})`
        : "";
    const prefix = r.envPrefix.padEnd(12);
    if (r.status === "applied") {
      lines.push(`    ${name}  ${prefix}applied ${r.applied.length} → ${r.version}${alias}`);
    } else if (r.status === "up-to-date") {
      lines.push(`    ${name}  ${prefix}up to date at ${r.version}${alias}`);
    } else if (r.status === "would-apply") {
      lines.push(`    ${name}  ${prefix}would apply ${r.pending.length} → ${r.version} (connection verified)${alias}`);
    } else {
      lines.push(`    ${name}  ${prefix}${r.status.toUpperCase()}${alias}`);
      lines.push(`    ${" ".repeat(width)}  ${" ".repeat(12)}${r.reason.split("\n")[0]}`);
    }
    // The seed's own line, indented under the instance it belongs
    // to, so a green migration with a failed seed cannot be read as
    // a green instance.
    if (r.seed) {
      const indent = `    ${" ".repeat(width)}  ${" ".repeat(12)}`;
      if (r.seed.status === "seeded") {
        lines.push(`${indent}seed: ${r.seed.detail}`);
      } else if (r.seed.status === "would-seed") {
        lines.push(`${indent}seed: would run`);
      } else if (r.seed.status === "skipped") {
        lines.push(`${indent}seed: skipped, ${r.seed.reason}`);
      } else {
        lines.push(`${indent}seed: FAILED — ${r.seed.reason.split("\n")[0]}`);
      }
    }
  }
  // Listed, not omitted. An operator reading this before a deploy has
  // to be able to tell "deliberately offline" from "forgotten".
  for (const r of skipped) {
    const name = r.subdomain.padEnd(width);
    lines.push(`    ${name}  ${"".padEnd(12)}skipped, registry says "${r.status}"`);
  }
  return lines;
}

function summarize(
  results: InstanceResult[],
  skipped: Array<{ subdomain: string; status: string }>
): void {
  console.log("");
  console.log("  Summary");
  console.log("  ───────");
  for (const line of summaryLines(results, skipped)) console.log(line);
  console.log("");
}

function parseArgs(argv: string[]): {
  dryRun: boolean;
  dbUrl: string | null;
  seed: boolean;
} {
  let dryRun = false;
  let dbUrl: string | null = null;
  let seed = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dry-run") {
      dryRun = true;
    } else if (argv[i] === "--seed") {
      seed = true;
    } else if (argv[i] === "--db-url") {
      dbUrl = argv[i + 1] ?? null;
      if (!dbUrl) fail("--db-url needs a connection string.");
      i += 1;
    } else {
      fail(
        `Unknown argument ${argv[i]}. ` +
          `Options: --dry-run, --seed, --db-url <url>.`
      );
    }
  }
  return { dryRun, dbUrl, seed };
}

// One database, named directly. Used for the dev clone, which has no
// registry row because it is not a live instance.
async function migrateOne(dbUrl: string, dryRun: boolean): Promise<void> {
  const localMigrations = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  console.log("");
  console.log(
    `  ${dryRun ? "Checking" : "Migrating"} one off-registry database ` +
      `against ${localMigrations.length} local migrations`
  );
  // The URL carries a password, so it is never echoed.
  console.log("");

  const args = ["db", "push", "--db-url", dbUrl, "--include-all"];
  if (dryRun) args.push("--dry-run");
  const result = await runCommand("supabase", args);
  process.stdout.write(result.stdout);
  if (result.code !== 0) {
    console.error(`\n  supabase db push exited ${result.code}.`);
    console.error(`  ${(result.stderr || result.stdout).trim().split("\n").pop()}\n`);
    process.exit(1);
  }
  console.log(`\n  Done.\n`);
}

async function main(): Promise<void> {
  const { dryRun, dbUrl, seed } = parseArgs(process.argv.slice(2));

  if (dbUrl) {
    // No registry, no control plane, no state files: one database,
    // named by the caller.
    await migrateOne(dbUrl, dryRun);
    return;
  }

  const missing = REQUIRED.filter((n) => !process.env[n]?.trim());
  if (missing.length > 0) {
    fail(
      `Missing configuration:\n${missing.map((n) => `    ${n}`).join("\n")}\n\n` +
        `  These live in .env.provisioning. See .env.provisioning.example.`
    );
  }

  const control = createClient(
    process.env.CONTROL_PLANE_SUPABASE_URL as string,
    process.env.CONTROL_PLANE_SUPABASE_SERVICE_KEY as string,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  // Every row, not just the active ones. The status filter lives in
  // selectMigratableRows so the rule is a tested function rather than
  // a clause in a query string, and so suspended instances can be
  // named in the summary instead of silently missing from it.
  const { data, error } = await control
    .from("instances")
    .select("subdomain, display_name, env_prefix, status")
    .order("subdomain");
  if (error) fail(`Couldn't read the registry: ${error.message}`);

  const { migrate: rows, skipped } = selectMigratableRows(
    (data ?? []) as RegistryRow[]
  );
  if (rows.length === 0) {
    if (skipped.length > 0) {
      console.log(
        `\n  No active instances. ${skipped.length} suspended: ` +
          `${skipped.map((r) => r.subdomain).join(", ")}.\n`
      );
    } else {
      console.log("\n  No instances in the registry. Nothing to do.\n");
    }
    return;
  }

  const management = createManagementClient({
    token: process.env.SUPABASE_MANAGEMENT_TOKEN as string,
  });

  const localMigrations = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  console.log("");
  console.log(
    `  ${dryRun ? "Checking" : "Migrating"} ${rows.length} active instance${rows.length === 1 ? "" : "s"} ` +
      `against ${localMigrations.length} local migrations`
  );
  console.log(`  Control plane: ${process.env.CONTROL_PLANE_SUPABASE_URL}`);
  if (skipped.length > 0) {
    console.log(
      `  Skipping ${skipped.length} suspended: ` +
        `${skipped.map((r) => `${r.subdomain} (${r.status})`).join(", ")}`
    );
  }
  if (seed) {
    console.log(`  --seed: will also run ${SEED_FILE} on each instance`);
  }
  console.log("");

  const results = await migrateAllInstances({
    rows,
    env: process.env,
    readState: readStateFile,
    localMigrations,
    dryRun,
    poolerHostFor: async (ref) => {
      const pooler = await management.getPoolerConfig(ref);
      const host = pooler[0]?.db_host;
      if (!host) {
        throw new Error(
          `project ${ref} reported no pooler host, so there is no ` +
            `IPv4-reachable way in`
        );
      }
      return host;
    },
    appliedVersionsFor: async (ref) => {
      try {
        const versions = await management.runQuery<{ version: string }>(
          ref,
          `select version from ${MIGRATIONS_TABLE} order by version`
        );
        return new Set(versions.map((v) => String(v.version)));
      } catch {
        // Absent until the first push: "nothing applied".
        return new Set();
      }
    },
    databaseShape: async (ref) => {
      const [row] = await management.runQuery<{
        has_migration_table: boolean;
        public_tables: number;
      }>(
        ref,
        `select
           to_regclass('${MIGRATIONS_TABLE}') is not null as has_migration_table,
           (select count(*)::int from information_schema.tables
             where table_schema = 'public') as public_tables`
      );
      return {
        hasMigrationTable: Boolean(row?.has_migration_table),
        publicTables: Number(row?.public_tables ?? 0),
      };
    },
    runCommand,
    log: (line) => console.log(line),
    // Only wired up when asked for. Absent, migrateAllInstances does
    // not seed and reports no seed outcome at all, which keeps an
    // ordinary run's summary exactly as it was.
    seedInstance: seed
      ? async (ref) => {
          const sql = readFileSync(SEED_FILE, "utf8").trim();
          if (sql.length === 0) {
            throw new Error(
              `${SEED_FILE} is empty or missing, so --seed has nothing ` +
                "to deliver. Refusing to report a seed that did not happen."
            );
          }
          await management.runQuery(ref, sql);
          // Counts, not "ok". They are the only cheap evidence the
          // seed actually wrote something, and they are what makes a
          // silently-empty seed file visible.
          const [counts] = await management.runQuery<{
            classroom_categories: number;
            strengths_items: number;
          }>(
            ref,
            `select
               (select count(*) from public.classroom_categories) as classroom_categories,
               (select count(*) from public.strengths_items) as strengths_items`
          );
          return (
            `${counts?.classroom_categories ?? 0} classroom categories, ` +
            `${counts?.strengths_items ?? 0} strengths items`
          );
        }
      : undefined,
  });

  summarize(results, skipped);

  const problems = results.filter(isProblem);
  if (problems.length > 0) {
    console.error(
      `  ${problems.length} of ${results.length} instances need attention. ` +
        `Do NOT promote the code deploy until every instance is green.\n`
    );
    process.exit(1);
  }
  if (dryRun) {
    console.log("  --dry-run: nothing was applied.\n");
  }
}

// Run ONLY when this file is the process entry point, never on
// import.
//
// scripts/lib/provisioning/summary-output.test.ts imports
// summaryLines() from here, because the printed summary is the thing
// worth asserting and it is defined in this file. Without this guard
// that import EXECUTES THE MIGRATION RUNNER as a side effect.
//
// It did. CI went red on the merge to main with "process.exit
// unexpectedly called with 1", because there is no .env.provisioning
// on a runner, so main() reached fail() and killed the test process.
//
// The red build was the harmless half. Locally .env.provisioning does
// exist, and what saved us there was an accident: parseArgs() sees
// vitest's own argv, does not recognise it, and exits before main()
// reaches the control plane. Invoked with no trailing arguments,
// parseArgs would have returned defaults and a plain `vitest run`
// would have migrated every live instance in the registry.
//
// A module that performs irreversible work when imported is not safe
// to import at all, and "no test imports it yet" is not a property
// anyone can maintain. The guard makes the file inert on import.
const invokedDirectly =
  argv[1] !== undefined &&
  realpathSync(fileURLToPath(import.meta.url)) === realpathSync(argv[1]);

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
