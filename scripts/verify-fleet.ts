// npm run verify:fleet — reads every instance back after a fleet
// apply and says whether the fleet actually matches the repo.
//
// Step 10 of the deploy ritual. `migrate:instances` tells you what its
// run did; this tells you what the fleet IS. The difference matters on
// exactly the days it is hardest to notice: an instance the run never
// reached, a registry row added between the apply and now, or a push
// that reported success against a database that did not keep it.
//
// READ-ONLY. The only statement it issues is
//   select version from supabase_migrations.schema_migrations
// via the Management API. It takes no writable client.
//
// EXITS NON-ZERO if any instance is behind OR unreachable. An
// unreachable instance is not a pass with a caveat; it is the case
// this script exists to catch.

import { readdirSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  latestVersion,
  MIGRATIONS_TABLE,
  type RegistryRow,
} from "./lib/provisioning/migrate.ts";
import { verifyAllInstances, summarize } from "./lib/provisioning/verify-fleet.ts";
import { createManagementClient } from "./lib/provisioning/supabase-management.ts";
import { stateFileFor, type InstanceState } from "./lib/provisioning/state.ts";
import { isEntryPoint } from "./lib/entry-point.ts";

const MIGRATIONS_DIR = "supabase/migrations";

try {
  process.loadEnvFile(".env.provisioning");
} catch {
  // Already in the environment, or genuinely absent — the checks
  // below say which.
}

function fail(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

function readStateFile(subdomain: string): InstanceState | null {
  try {
    return JSON.parse(
      readFileSync(stateFileFor(subdomain), "utf8")
    ) as InstanceState;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const REQUIRED = [
    "CONTROL_PLANE_SUPABASE_URL",
    "CONTROL_PLANE_SUPABASE_SERVICE_KEY",
    "SUPABASE_MANAGEMENT_TOKEN",
  ];
  const missing = REQUIRED.filter((n) => !process.env[n]?.trim());
  if (missing.length > 0) {
    fail(
      `Missing configuration:\n${missing.map((n) => `    ${n}`).join("\n")}\n\n` +
        `  These live in .env.provisioning. See .env.provisioning.example.`
    );
  }

  const localMigrations = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const expected = latestVersion(localMigrations);

  const control = createClient(
    process.env.CONTROL_PLANE_SUPABASE_URL as string,
    process.env.CONTROL_PLANE_SUPABASE_SERVICE_KEY as string,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { data, error } = await control
    .from("instances")
    .select("subdomain, display_name, env_prefix, status")
    .order("subdomain");
  if (error) fail(`Couldn't read the registry: ${error.message}`);

  const management = createManagementClient({
    token: process.env.SUPABASE_MANAGEMENT_TOKEN as string,
  });

  console.log(
    `\n  Verifying the fleet against ${MIGRATIONS_DIR} ` +
      `(repo is at ${expected ?? "(none)"}).\n`
  );

  const verdicts = await verifyAllInstances({
    rows: (data ?? []) as RegistryRow[],
    env: process.env,
    readState: readStateFile,
    localMigrations,
    appliedVersionsFor: async (ref) => {
      const versions = await management.runQuery<{ version: string }>(
        ref,
        `select version from ${MIGRATIONS_TABLE} order by version`
      );
      return new Set(versions.map((v) => String(v.version)));
    },
  });

  const { ok, lines } = summarize(verdicts, expected);
  for (const line of lines) console.log(line);

  if (!ok) {
    console.error(
      `  Fleet does not match the repo. Re-run ` +
        `\`npm run migrate:instances\` for the instances above, or ` +
        `fix the credentials for the unreachable ones, then verify ` +
        `again.\n`
    );
    process.exit(1);
  }
  console.log("");
}

if (isEntryPoint(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
