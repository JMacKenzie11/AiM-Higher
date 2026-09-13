/**
 * scripts/scrub-dev-secrets.ts
 *
 * Usage:
 *   npm run scrub:dev -- --dry-run   # what it would delete
 *   npm run scrub:dev
 *
 * Deletes live OAuth credentials from the dev clone.
 *
 * WHY THIS EXISTS. The clone is made by copying production, and the
 * copy brings `oauth_credentials` with it: one row per company that
 * has connected Google Drive, each holding a refresh token that does
 * not expire on its own. Those are live client credentials, and after
 * a refresh they are sitting in a database whose whole purpose is that
 * people can experiment against it. Dev has no business holding them.
 *
 * It is a delete rather than a null-out because a row with no token is
 * a connection that looks present and cannot work. Deleting says
 * "not connected", which is the truth on dev, and the operator can
 * reconnect a dev folder if they need one.
 *
 * Transcript sources are deliberately left alone. They carry folder
 * ids, not secrets, and removing them would change what the app looks
 * like on dev for no security gain — a source with no credential just
 * fails to ingest, which is correct.
 *
 * Run it after every clone refresh, beside `npm run seed:e2e`. See
 * docs/e2e.md.
 */

import { createClient } from "@supabase/supabase-js";

import { refFromSupabaseUrl } from "./lib/provisioning/migrate.ts";
import { isEntryPoint } from "./lib/entry-point.ts";

for (const file of [".env.local", ".env.provisioning"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // Reported by name below if something is actually missing.
  }
}

// The guard, by project ref rather than by URL string.
//
// seed:e2e compares URLs, which is right there and wrong here only in
// that a trailing slash or a http/https difference would slip past. A
// ref is the identity of the database; two spellings of the same
// project must not read as two projects.
export function refusalReason(
  env: Record<string, string | undefined>
): string | null {
  const target = env.LOCAL_INSTANCE_SUPABASE_URL;
  const ref = target ? refFromSupabaseUrl(target) : null;
  if (!ref) {
    return (
      "LOCAL_INSTANCE_SUPABASE_URL is not set, or is not a Supabase " +
      "project URL. This script is for the dev clone. See docs/e2e.md."
    );
  }
  for (const name of [
    "PROD_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "CONTROL_PLANE_SUPABASE_URL",
  ] as const) {
    const other = env[name] ? refFromSupabaseUrl(env[name] as string) : null;
    if (other && other === ref) {
      return (
        `REFUSING TO RUN: LOCAL_INSTANCE_SUPABASE_URL resolves to ${ref}, ` +
        `which is also ${name}. This script deletes OAuth credentials ` +
        `and is for the dev clone only.`
      );
    }
  }
  return null;
}

async function main(): Promise<void> {
  const dryRun = process.argv.slice(2).includes("--dry-run");
  const unknown = process.argv.slice(2).filter((a) => a !== "--dry-run");
  if (unknown.length > 0) {
    console.error(`\n  Unknown argument ${unknown[0]}. Options: --dry-run.\n`);
    process.exit(1);
  }

  const reason = refusalReason(process.env);
  if (reason) {
    console.error(`\n  ${reason}\n`);
    process.exit(1);
  }

  const url = process.env.LOCAL_INSTANCE_SUPABASE_URL as string;
  const key = process.env.LOCAL_INSTANCE_SUPABASE_SERVICE_KEY;
  if (!key) {
    console.error(
      "\n  LOCAL_INSTANCE_SUPABASE_SERVICE_KEY is not set. See docs/e2e.md.\n"
    );
    process.exit(1);
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // provider and company, never the token itself. A script that prints
  // a credential to justify deleting it has not helped. See E3.
  const { data, error } = await admin
    .from("oauth_credentials")
    .select("id, provider, company_id");
  if (error) {
    console.error(`\n  Couldn't read oauth_credentials: ${error.message}\n`);
    process.exit(1);
  }

  const rows = data ?? [];
  console.log("");
  console.log(`  Dev clone ${refFromSupabaseUrl(url)}`);
  if (rows.length === 0) {
    console.log("  oauth_credentials is already empty. Nothing to do.\n");
    return;
  }
  const byProvider = new Map<string, number>();
  for (const row of rows) {
    const p = String(row.provider);
    byProvider.set(p, (byProvider.get(p) ?? 0) + 1);
  }
  const summary = [...byProvider]
    .map(([p, n]) => `${n} ${p}`)
    .join(", ");
  console.log(
    `  ${rows.length} live credential${rows.length === 1 ? "" : "s"}: ${summary}`
  );

  if (dryRun) {
    console.log("  --dry-run: nothing was deleted.\n");
    return;
  }

  const { error: deleteError } = await admin
    .from("oauth_credentials")
    .delete()
    .not("id", "is", null);
  if (deleteError) {
    console.error(`\n  Delete failed: ${deleteError.message}\n`);
    process.exit(1);
  }

  // Read back rather than trust the write. RLS is forced on this table
  // and a service-role delete that matched nothing returns no error.
  const { count } = await admin
    .from("oauth_credentials")
    .select("id", { count: "exact", head: true });
  if ((count ?? 0) > 0) {
    console.error(
      `\n  ${count} row(s) still present after the delete. Stop and look.\n`
    );
    process.exit(1);
  }
  console.log(`  Deleted ${rows.length}. oauth_credentials is empty.\n`);
}

if (isEntryPoint(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
