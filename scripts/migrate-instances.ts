/**
 * scripts/migrate-instances.ts
 *
 * Applies pending migrations to every active instance in the registry.
 *
 * Usage:
 *   npm run migrate:instances            # apply
 *   npm run migrate:instances -- --dry-run
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

function summarize(results: InstanceResult[]): void {
  const width = Math.max(9, ...results.map((r) => r.subdomain.length));
  console.log("");
  console.log("  Summary");
  console.log("  ───────");
  for (const r of results) {
    const name = r.subdomain.padEnd(width);
    const prefix = r.envPrefix.padEnd(12);
    if (r.status === "applied") {
      console.log(`    ${name}  ${prefix}applied ${r.applied.length} → ${r.version}`);
    } else if (r.status === "up-to-date") {
      console.log(`    ${name}  ${prefix}up to date at ${r.version}`);
    } else if (r.status === "would-apply") {
      console.log(`    ${name}  ${prefix}would apply ${r.pending.length} → ${r.version}`);
    } else {
      console.log(`    ${name}  ${prefix}${r.status.toUpperCase()}`);
      console.log(`    ${" ".repeat(width)}  ${" ".repeat(12)}${r.reason.split("\n")[0]}`);
    }
  }
  console.log("");
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const unknown = process.argv
    .slice(2)
    .filter((a) => a !== "--dry-run");
  if (unknown.length > 0) {
    fail(`Unknown argument ${unknown[0]}. The only option is --dry-run.`);
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
