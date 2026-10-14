// An instance's MCP route secret (0275): its own random secret, not
// derived from anything (Jason, 2026-10-14). The app sends it on every
// database request it makes for an outside assistant; the database
// keeps only its SHA-256 in aims_private.mcp_route_key.
//
//   npm run mcp:route-key -- --dev --generate     the dev clone: a new secret into
//                                                 .env.local (LOCAL_INSTANCE_MCP_ROUTE_SECRET)
//                                                 and its hash into the clone
//   npm run mcp:route-key -- --prefix PROD --generate
//                                                 a new secret into Vercel (sensitive,
//                                                 Production only) as PROD_MCP_ROUTE_SECRET
//                                                 and into .env.provisioning, then its hash
//                                                 into the instance's database
//   npm run mcp:route-key -- --prefix PROD        rewrite the hash from the local copy
//   add --check instead to compare without writing
//
// Order on --generate: Vercel, then the local copy, then the database,
// so a failure part-way leaves the database as it was. A new Vercel
// value takes effect on the next deploy; until then the deployed app
// still sends the old one, so generate before switching MCP on, or
// redeploy after. Nothing secret is printed.
//
// A write to a live database (and to Vercel): on anything but the dev
// clone it runs on Jason's explicit instruction for that run.

import { readFileSync, writeFileSync } from "node:fs";
import { createManagementClient } from "./lib/provisioning/supabase-management.ts";
import { createVercelClient } from "./lib/provisioning/vercel.ts";
import { generateRouteSecret, routeKeyHash } from "../src/lib/mcp/route-key.ts";
import { isEntryPoint } from "./lib/entry-point.ts";

function fail(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

// Replace KEY=… in an env file, or append it. Keeps the file's mode.
export function setEnvLine(source: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(source)) return source.replace(re, line);
  return `${source.replace(/\n*$/, "\n")}${line}\n`;
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
  const generate = argv.includes("--generate");
  const dev = argv.includes("--dev");
  const prefixAt = argv.indexOf("--prefix");
  const prefix = prefixAt >= 0 ? argv[prefixAt + 1] : undefined;
  if (dev === Boolean(prefix)) fail("Name one instance: --dev, or --prefix <ENV_PREFIX>.");
  if (check && generate) fail("--check or --generate, not both.");

  const urlVar = dev ? "LOCAL_INSTANCE_SUPABASE_URL" : `${prefix}_SUPABASE_URL`;
  const secretVar = dev ? "LOCAL_INSTANCE_MCP_ROUTE_SECRET" : `${prefix}_MCP_ROUTE_SECRET`;
  const envFile = dev ? ".env.local" : ".env.provisioning";
  const url = process.env[urlVar];
  if (!url) fail(`${urlVar} must be set.`);
  const ref: string =
    /^https:\/\/([a-z0-9]+)\.supabase\.co/.exec(url)?.[1] ?? fail(`${urlVar} is not a Supabase project URL.`);
  const token = process.env.SUPABASE_MANAGEMENT_TOKEN?.trim();
  if (!token) fail("SUPABASE_MANAGEMENT_TOKEN is not set in .env.provisioning.");
  const mgmt = createManagementClient({ token });

  const vercel = dev
    ? null
    : createVercelClient({
        token: process.env.VERCEL_TOKEN ?? fail("VERCEL_TOKEN is not set."),
        projectId: process.env.VERCEL_PROJECT_ID ?? fail("VERCEL_PROJECT_ID is not set."),
        // The team, from the env or the repo's own Vercel link.
        teamId:
          process.env.VERCEL_TEAM_ID ??
          (JSON.parse(readFileSync(".vercel/project.json", "utf8")) as { orgId?: string }).orgId,
      });

  if (check) {
    const secret = process.env[secretVar];
    const [row] = await mgmt.runQuery<{ h: string | null }>(ref, "select (select key_sha256 from aims_private.mcp_route_key) as h;");
    const db = !row?.h ? "NOT SET in the database" : !secret ? `set in the database, but ${secretVar} is not in ${envFile}` : row.h === routeKeyHash(secret) ? "matches the database" : "DOES NOT MATCH the database";
    let onVercel = "";
    if (vercel) {
      const v = (await vercel.listEnv()).find((e) => e.key === secretVar && (e.target ?? []).includes("production"));
      onVercel = v ? ` | Vercel ${secretVar}: present (${v.type}, production)` : ` | Vercel ${secretVar}: NOT SET`;
    }
    console.log(`\n  ${ref}: ${secretVar} ${db}${onVercel}\n`);
    process.exit(row?.h && secret && row.h === routeKeyHash(secret) ? 0 : 1);
  }

  let secret = process.env[secretVar];
  if (generate) {
    secret = generateRouteSecret();
    if (vercel) {
      const existing = (await vercel.listEnv()).find((e) => e.key === secretVar);
      if (existing) await vercel.updateEnv(existing.id, { value: secret, type: "sensitive", target: ["production"] });
      else await vercel.createEnv({ key: secretVar, value: secret, type: "sensitive", target: ["production"] });
      console.log(`  Vercel: ${secretVar} ${existing ? "replaced" : "created"} (sensitive, Production only)`);
    }
    writeFileSync(envFile, setEnvLine(readFileSync(envFile, "utf8"), secretVar, secret));
    console.log(`  ${envFile}: ${secretVar} written`);
  }
  if (!secret) fail(`${secretVar} is not in ${envFile}. Use --generate to make one.`);

  await mgmt.runQuery(
    ref,
    `insert into aims_private.mcp_route_key (id, key_sha256) values (true, '${routeKeyHash(secret)}')
     on conflict (id) do update set key_sha256 = excluded.key_sha256, set_at = now();`
  );
  console.log(`\n  ${ref}: route secret hash written.${vercel && generate ? " Redeploy for the app to send the new secret." : ""}\n`);
}

// Guarded: importing this file must never write anything
// (scripts/lib/entry-point.ts).
if (isEntryPoint(import.meta.url)) {
  main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
}
