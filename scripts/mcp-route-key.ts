// Writes (or checks) an instance's MCP route key hash (0275).
//
//   npm run mcp:route-key -- --dev            the dev clone (LOCAL_INSTANCE_*)
//   npm run mcp:route-key -- --prefix PROD    an instance by its env prefix
//   add --check to compare without writing
//
// The key is derived from the instance's service key (src/lib/mcp/
// route-key.ts); only its SHA-256 goes to the database, into
// aims_private.mcp_route_key, through the Management API. Nothing secret
// is printed. Until this runs on an instance, every outside assistant
// there is refused at the database: 0275 fails closed.
//
// A write to a live database: on anything but the dev clone it runs on
// Jason's explicit instruction for that run (CLAUDE.md, Scope).

import { createManagementClient } from "./lib/provisioning/supabase-management.ts";
import { routeKeyFor, routeKeyHash } from "../src/lib/mcp/route-key.ts";
import { isEntryPoint } from "./lib/entry-point.ts";

function fail(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  for (const f of [".env.local", ".env.provisioning"]) {
    try {
      process.loadEnvFile(f);
    } catch {
      // Missing values are reported by name below.
    }
  }

  const argv = process.argv.slice(2);
  const check = argv.includes("--check");
  const dev = argv.includes("--dev");
  const prefixAt = argv.indexOf("--prefix");
  const prefix = prefixAt >= 0 ? argv[prefixAt + 1] : undefined;
  if (dev === Boolean(prefix)) fail("Name one instance: --dev, or --prefix <ENV_PREFIX>.");

  const urlVar = dev ? "LOCAL_INSTANCE_SUPABASE_URL" : `${prefix}_SUPABASE_URL`;
  const keyVar = dev ? "LOCAL_INSTANCE_SUPABASE_SERVICE_KEY" : `${prefix}_SUPABASE_SERVICE_KEY`;
  const url = process.env[urlVar];
  const serviceKey = process.env[keyVar];
  if (!url || !serviceKey) fail(`${urlVar} and ${keyVar} must both be set.`);
  const ref: string =
    /^https:\/\/([a-z0-9]+)\.supabase\.co/.exec(url)?.[1] ?? fail(`${urlVar} is not a Supabase project URL.`);
  const token = process.env.SUPABASE_MANAGEMENT_TOKEN?.trim();
  if (!token) fail("SUPABASE_MANAGEMENT_TOKEN is not set in .env.provisioning.");

  const hash = routeKeyHash(routeKeyFor(serviceKey));
  const mgmt = createManagementClient({ token });

  if (check) {
    const rows = await mgmt.runQuery<{ matches: boolean | null }>(
      ref,
      `select (select key_sha256 = '${hash}' from aims_private.mcp_route_key) as matches;`
    );
    const m = rows[0]?.matches;
    console.log(
      `\n  ${ref}: route key ${m === true ? "set and matches" : m === false ? "set, but DOES NOT MATCH this service key" : "NOT SET"}\n`
    );
    process.exit(m === true ? 0 : 1);
  }

  await mgmt.runQuery(
    ref,
    `insert into aims_private.mcp_route_key (id, key_sha256) values (true, '${hash}')
     on conflict (id) do update set key_sha256 = excluded.key_sha256, set_at = now();`
  );
  console.log(`\n  ${ref}: route key hash written.\n`);
}

// Guarded: importing this file must never write to a database
// (scripts/lib/entry-point.ts).
if (isEntryPoint(import.meta.url)) {
  main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
}
