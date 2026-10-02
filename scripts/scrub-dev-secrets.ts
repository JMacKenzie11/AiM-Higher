/**
 * scripts/scrub-dev-secrets.ts
 *
 * Usage:
 *   npm run scrub:dev -- --dry-run      # what it would delete
 *   npm run scrub:dev
 *   npm run scrub:dev -- --rotate-key   # also give dev its own Vault key
 *
 * Deletes live credentials from the dev clone: oauth_credentials, and
 * every connection's secret in Supabase Vault (0257). Then checks that
 * the clone's Vault key is not production's.
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
 * THE VAULT KEY (2026-10-02). The clone is made with Supabase's
 * "Restore to a new project", which copies the project's Vault key:
 * dev's key matched production's when this was first checked. So the
 * clone can decrypt every secret it copies. Deleting the secrets is the
 * first wall. The second is that dev's key must not be production's:
 * this compares the two keys' fingerprints through the Management API
 * (never the keys) and fails while they match. --rotate-key gives dev a
 * fresh random key, after its secrets are gone, and checks again. A key
 * change makes anything encrypted with the old key unreadable on dev,
 * which is the point; it is never run anywhere but the clone.
 *
 * Run it after every clone refresh, beside `npm run seed:e2e`. See
 * docs/e2e.md.
 */

import { createHash, randomBytes } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

// A fresh root key: 64 hex characters, as Supabase expects.
export function newRootKey(): string {
  return randomBytes(32).toString("hex");
}

export function fingerprint(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export type KeyVerdict = "own key" | "production's key" | "unknown";

export function keyVerdict(dev: string | null, prod: string | null): KeyVerdict {
  if (!dev || !prod) return "unknown";
  return dev === prod ? "production's key" : "own key";
}

export function parseArgs(argv: string[]): { dryRun: boolean; rotateKey: boolean } | { error: string } {
  const args = argv.filter((a) => a !== "--");
  const known = new Set(["--dry-run", "--rotate-key"]);
  const unknown = args.find((a) => !known.has(a));
  if (unknown) return { error: `Unknown argument ${unknown}. Options: --dry-run, --rotate-key.` };
  const dryRun = args.includes("--dry-run");
  const rotateKey = args.includes("--rotate-key");
  if (dryRun && rotateKey) return { error: "--dry-run changes nothing, so it cannot rotate the key. Pass one." };
  return { dryRun, rotateKey };
}

// The project's Vault root key, fingerprinted in this process. The key
// itself is never printed, logged or passed on a command line (E3).
async function rootKeyFingerprint(ref: string, token: string): Promise<string | null> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/pgsodium`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { root_key?: unknown };
  return typeof body.root_key === "string" && body.root_key ? fingerprint(body.root_key) : null;
}

async function setRootKey(ref: string, token: string, key: string): Promise<boolean> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/pgsodium`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ root_key: key }),
  });
  return res.ok;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if ("error" in parsed) {
    console.error(`\n  ${parsed.error}\n`);
    process.exit(1);
  }
  const { dryRun, rotateKey } = parsed;

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

  console.log("");
  console.log(`  Dev clone ${refFromSupabaseUrl(url)}`);
  await scrubOauthCredentials(admin, dryRun);
  await scrubConnections(admin, dryRun);
  await checkVaultKey(refFromSupabaseUrl(url) as string, dryRun, rotateKey);
  console.log("");
}

type Admin = SupabaseClient;

async function scrubOauthCredentials(admin: Admin, dryRun: boolean): Promise<void> {
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
  if (rows.length === 0) {
    console.log("  oauth_credentials is already empty.");
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
    console.log("  --dry-run: nothing was deleted.");
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
  console.log(`  Deleted ${rows.length}. oauth_credentials is empty.`);
}

// Every connection's secret, through the one function that deletes a
// secret and its row together (connection_remove_service, 0257). One at
// a time: there is deliberately no "delete them all" function on any
// instance, production included.
async function scrubConnections(admin: Admin, dryRun: boolean): Promise<void> {
  const { data, error } = await admin.from("connections").select("company_id, connector");
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) {
      console.log("  connections is not on this schema (before 0257). Nothing to do.");
      return;
    }
    console.error(`\n  Couldn't read connections: ${error.message}\n`);
    process.exit(1);
  }
  const rows = (data ?? []) as Array<{ company_id: string; connector: string }>;
  if (rows.length === 0) {
    console.log("  No connection secrets in the vault.");
    return;
  }
  const byConnector = new Map<string, number>();
  for (const r of rows) byConnector.set(r.connector, (byConnector.get(r.connector) ?? 0) + 1);
  console.log(`  ${rows.length} connection secret(s) in the vault: ${[...byConnector].map(([c, n]) => `${n} ${c}`).join(", ")}`);
  if (dryRun) {
    console.log("  --dry-run: nothing was deleted.");
    return;
  }
  for (const r of rows) {
    const { error: removeError } = await admin.rpc("connection_remove_service", {
      p_company_id: r.company_id,
      p_connector: r.connector,
    });
    if (removeError) {
      console.error(`\n  Removing a ${r.connector} connection failed: ${removeError.message}\n`);
      process.exit(1);
    }
  }
  const { count } = await admin.from("connections").select("id", { count: "exact", head: true });
  if ((count ?? 0) > 0) {
    console.error(`\n  ${count} connection(s) still present after the delete. Stop and look.\n`);
    process.exit(1);
  }
  console.log(`  Deleted ${rows.length} connection secret(s). The vault holds none.`);
}

async function checkVaultKey(devRef: string, dryRun: boolean, rotateKey: boolean): Promise<void> {
  const token = process.env.SUPABASE_MANAGEMENT_TOKEN;
  const prodRef = process.env.PROD_SUPABASE_URL ? refFromSupabaseUrl(process.env.PROD_SUPABASE_URL) : null;
  if (!token || !prodRef) {
    console.error("\n  SUPABASE_MANAGEMENT_TOKEN and PROD_SUPABASE_URL are needed to check the Vault key. See docs/e2e.md.\n");
    process.exit(1);
  }
  const verdict = keyVerdict(await rootKeyFingerprint(devRef, token), await rootKeyFingerprint(prodRef, token));
  if (verdict === "unknown") {
    console.error("\n  Couldn't read the Vault keys' fingerprints from the Management API. Stop and look.\n");
    process.exit(1);
  }
  if (verdict === "own key") {
    console.log("  Dev's Vault key is its own, not production's.");
    return;
  }
  if (!rotateKey) {
    console.error(
      "\n  Dev's Vault key is PRODUCTION'S, so dev could decrypt anything copied from production." +
        (dryRun ? "" : "\n  Its secrets are deleted. Run again with --rotate-key to give dev its own key.") +
        "\n"
    );
    process.exit(1);
  }
  if (!(await setRootKey(devRef, token, newRootKey()))) {
    console.error("\n  Setting dev's Vault key failed. Stop and look.\n");
    process.exit(1);
  }
  const after = keyVerdict(await rootKeyFingerprint(devRef, token), await rootKeyFingerprint(prodRef, token));
  if (after !== "own key") {
    console.error(`\n  After the change, dev's key reads as: ${after}. Stop and look.\n`);
    process.exit(1);
  }
  console.log("  Dev's Vault key was production's. It now has its own.");
}

if (isEntryPoint(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
