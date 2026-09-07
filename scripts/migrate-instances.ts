/**
 * scripts/migrate-instances.ts
 *
 * Applies pending migrations to every active instance in the registry.
 *
 * Usage:
 *   npm run migrate:instances                    # every active instance
 *   npm run migrate:instances -- --dry-run
 *   npm run migrate:instances -- --db-url "<url>"  # one off-registry database
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
import { readdirSync, readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import {
  MIGRATIONS_TABLE,
  isProblem,
  migrateAllInstances,
  type InstanceResult,
  type RegistryRow,
} from "./lib/provisioning/migrate.ts";
import { createManagementClient } from "./lib/provisioning/supabase-management.ts";
import { stateFileFor, type InstanceState } from "./lib/provisioning/state.ts";

const MIGRATIONS_DIR = "supabase/migrations";

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
export function summaryLines(results: InstanceResult[]): string[] {
  const width = Math.max(9, ...results.map((r) => r.subdomain.length));
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
  }
  return lines;
}

function summarize(results: InstanceResult[]): void {
  console.log("");
  console.log("  Summary");
  console.log("  ───────");
  for (const line of summaryLines(results)) console.log(line);
  console.log("");
}

function parseArgs(argv: string[]): { dryRun: boolean; dbUrl: string | null } {
  let dryRun = false;
  let dbUrl: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dry-run") {
      dryRun = true;
    } else if (argv[i] === "--db-url") {
      dbUrl = argv[i + 1] ?? null;
      if (!dbUrl) fail("--db-url needs a connection string.");
      i += 1;
    } else {
      fail(`Unknown argument ${argv[i]}. Options: --dry-run, --db-url <url>.`);
    }
  }
  return { dryRun, dbUrl };
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
  const { dryRun, dbUrl } = parseArgs(process.argv.slice(2));

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
  const { data, error } = await control
    .from("instances")
    .select("subdomain, display_name, env_prefix, status")
    .eq("status", "active")
    .order("subdomain");
  if (error) fail(`Couldn't read the registry: ${error.message}`);

  const rows = (data ?? []) as RegistryRow[];
  if (rows.length === 0) {
    console.log("\n  No active instances in the registry. Nothing to do.\n");
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
  });

  summarize(results);

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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
