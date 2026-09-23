// npm run instance:primary -- <subdomain> [--set | --unset]
// npm run instance:primary -- --dev  [--set | --unset]
//
// Says, or changes, whether a database is the one place agents are
// authored. Migration 0231 defaults every instance to "no", so this
// is how HQ becomes "yes" — once, deliberately, by a person.
//
// ---- WHY A SCRIPT AND NOT A MIGRATION --------------------------
//
// A migration runs identically on every instance, so it cannot mark
// one and not another. The fact is per-database and has to be set
// per-database.
//
// ---- WHAT IT REFUSES -------------------------------------------
//
// Without a flag it READS and changes nothing, so the safe thing is
// also the default thing. `--set` and `--unset` write, and each
// prints the before and after rather than "done", because "we wrote
// zero rows" and "we wrote the row it already said" look identical
// from a success message. E4.
//
// It names the database it is about to touch and the subdomain it
// resolved from, because the whole class of incident here is a
// command that ran perfectly against the wrong instance.

import { createClient } from "@supabase/supabase-js";
import { isEntryPoint } from "./lib/entry-point.ts";

try {
  process.loadEnvFile(".env.provisioning");
} catch {
  // Already in the environment, or genuinely absent.
}

function fail(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

export function parseArgs(argv: string[]): {
  subdomain: string | null;
  dev: boolean;
  write: boolean | null;
} {
  const args = argv.filter((a) => a !== "--");
  const set = args.includes("--set");
  const unset = args.includes("--unset");
  if (set && unset) fail("Pass --set or --unset, not both.");
  // The dev clone has no registry row — it is not a tenant — so it is
  // named the same way migrate:dev names it, by its own env vars.
  const dev = args.includes("--dev");
  const positional = args.filter((a) => !a.startsWith("--"));
  if (dev && positional.length > 0) {
    fail("--dev and a subdomain both name a database. Pass one.");
  }
  if (!dev && positional.length !== 1) {
    fail(
      "Usage: npm run instance:primary -- <subdomain> [--set | --unset]\n" +
        "         npm run instance:primary -- --dev [--set | --unset]\n" +
        "  With no flag it reads and writes nothing."
    );
  }
  return {
    subdomain: dev ? null : positional[0],
    dev,
    write: set ? true : unset ? false : null,
  };
}

// The env prefix for a subdomain, from the control plane's registry,
// so this cannot be pointed at a database by guessing a name.
async function resolvePrefix(subdomain: string): Promise<string> {
  const url = process.env.CONTROL_PLANE_SUPABASE_URL;
  const key = process.env.CONTROL_PLANE_SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    fail("CONTROL_PLANE_SUPABASE_URL / _SERVICE_KEY are not set.");
  }
  const cp = createClient(url, key);
  const { data, error } = await cp
    .from("instances")
    .select("subdomain, env_prefix, status")
    .eq("subdomain", subdomain)
    .maybeSingle<{ subdomain: string; env_prefix: string; status: string }>();
  if (error) fail(`Could not read the registry: ${error.message}`);
  if (!data) fail(`No instance named "${subdomain}" in the registry.`);
  return data.env_prefix;
}

async function main() {
  const { subdomain, dev, write } = parseArgs(process.argv.slice(2));
  if (dev) {
    // .env.local, not .env.provisioning: the dev clone's keys live
    // with the app's, which is where migrate:dev reads them from too.
    try {
      process.loadEnvFile(".env.local");
    } catch {
      // Already in the environment, or genuinely absent.
    }
  }
  const prefix = dev ? "LOCAL_INSTANCE" : await resolvePrefix(subdomain!);
  const url = process.env[`${prefix}_SUPABASE_URL`];
  const key = process.env[`${prefix}_SUPABASE_SERVICE_KEY`];
  if (!url || !key) {
    fail(`${prefix}_SUPABASE_URL / _SERVICE_KEY are not set in this shell.`);
  }
  const db = createClient(url, key);

  console.log(`\n  instance:  ${dev ? "the dev clone" : subdomain}  (${prefix})`);
  console.log(`  database:  ${url}`);

  const before = await db
    .from("instance_settings")
    .select("is_primary")
    .maybeSingle<{ is_primary: boolean }>();
  if (before.error) {
    fail(
      `Could not read instance_settings: ${before.error.message}\n` +
        "  Is this instance on migration 0231?"
    );
  }
  console.log(`  authoring: ${before.data?.is_primary === true ? "yes" : "no"}`);

  if (write === null) {
    console.log("\n  Read only. Pass --set or --unset to change it.\n");
    return;
  }

  const { error } = await db
    .from("instance_settings")
    .update({ is_primary: write, updated_at: new Date().toISOString() })
    .eq("singleton", true);
  if (error) fail(`The write failed: ${error.message}`);

  // Read it BACK. The update reporting no error is not evidence the
  // value changed — a policy, a stale row or a filter that matched
  // nothing all report exactly that.
  const after = await db
    .from("instance_settings")
    .select("is_primary")
    .maybeSingle<{ is_primary: boolean }>();
  if (after.error) fail(`Could not read it back: ${after.error.message}`);
  const now = after.data?.is_primary === true;
  if (now !== write) {
    fail(
      `The write reported success and the value is still ` +
        `${now ? "yes" : "no"}. Nothing changed.`
    );
  }
  console.log(`  authoring: ${now ? "yes" : "no"}   <- written and read back\n`);
}

if (isEntryPoint(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
