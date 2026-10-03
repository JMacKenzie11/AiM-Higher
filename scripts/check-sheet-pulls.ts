// npm run check:sheet-pulls -- --dev "Benson Seafood"
// npm run check:sheet-pulls -- --instance @ "Benson Seafood"
//
// Reads a company's mapped Sheets measures the way the Saturday pull
// does, through the company's Google connection, and WRITES NOTHING.
//
// ---- WHY IT EXISTS ---------------------------------------------
//
// Moving the Google tokens into the vault (0257) changes where every
// Sheets pull and every transcript ingest finds its credential. Jason
// (2026-10-02): "check Benson's weekly pull on dev before and after the
// move, and on production right after it ... Benson's numbers must not
// miss a week." A pull writes; this reads. It runs the pull's own
// decision (runPull) for the week the scheduler would pull next, so a
// broken credential, an unreachable sheet or a changed cell shows up
// here before it shows up as a missing week.
//
// It prints numbers from the client's own sheet and the outcome. It
// never prints a credential: the reader fetches the token itself.

import { createClient } from "@supabase/supabase-js";
import { isEntryPoint } from "./lib/entry-point.ts";
import { runWithInstance } from "@/lib/instances/context";
import type { InstanceConfig } from "@/lib/instances/types";
import { loadMappedMeasures } from "@/lib/external-measures/service";
import { googleSheetReader } from "@/lib/external-measures/sheets";
import { hubspotReader } from "@/lib/external-measures/hubspot-reader";
import { runPull, failureSentence } from "@/lib/external-measures/pull";
import { targetWeekEnding } from "@/lib/external-measures/schedule";
import { describeMapping } from "@/lib/external-measures/mapping";

for (const f of [".env.provisioning", ".env.local"]) {
  try {
    process.loadEnvFile(f);
  } catch {
    // Already in the environment, or genuinely absent.
  }
}

function fail(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

export function parseArgs(argv: string[]): { dev: boolean; subdomain: string | null; company: string } {
  const args = argv.filter((a) => a !== "--");
  const dev = args.includes("--dev");
  const at = args.indexOf("--instance");
  const subdomain = at >= 0 ? (args[at + 1] ?? null) : null;
  const rest = args.filter((a, i) => !a.startsWith("--") && !(at >= 0 && i === at + 1));
  if (dev === (subdomain !== null)) fail('Pass --dev or --instance <subdomain> (the registry calls the root instance "@").');
  if (rest.length !== 1) fail('Name one company, in quotes: npm run check:sheet-pulls -- --dev "Benson Seafood"');
  return { dev, subdomain, company: rest[0] };
}

// The instance's config, named the way migrate:dev and instance:primary
// name it: the dev clone by its own variables, anything else through
// the control plane's registry, never by guessing a prefix.
async function configFor(dev: boolean, subdomain: string | null): Promise<InstanceConfig> {
  let prefix = "LOCAL_INSTANCE";
  let label = "the dev clone";
  if (!dev) {
    const url = process.env.CONTROL_PLANE_SUPABASE_URL;
    const key = process.env.CONTROL_PLANE_SUPABASE_SERVICE_KEY;
    if (!url || !key) fail("CONTROL_PLANE_SUPABASE_URL / _SERVICE_KEY are not set.");
    const { data, error } = await createClient(url, key)
      .from("instances")
      .select("subdomain, env_prefix, display_name")
      .eq("subdomain", subdomain!)
      .maybeSingle<{ subdomain: string; env_prefix: string; display_name: string }>();
    if (error) fail(`Could not read the registry: ${error.message}`);
    if (!data) fail(`No instance "${subdomain}" in the registry.`);
    prefix = data.env_prefix;
    label = data.display_name;
  }
  const supabaseUrl = process.env[`${prefix}_SUPABASE_URL`];
  const supabaseServiceKey = process.env[`${prefix}_SUPABASE_SERVICE_KEY`];
  const supabaseAnonKey = process.env[`${prefix}_SUPABASE_ANON_KEY`] ?? "";
  if (!supabaseUrl || !supabaseServiceKey) fail(`${prefix}_SUPABASE_URL / _SERVICE_KEY are not set.`);
  return { subdomain: subdomain ?? "dev", displayName: label, supabaseUrl, supabaseAnonKey, supabaseServiceKey, status: "active" };
}

async function main() {
  const { dev, subdomain, company } = parseArgs(process.argv.slice(2));
  const instance = await configFor(dev, subdomain);
  console.log(`\n  instance: ${instance.displayName}  (${instance.supabaseUrl})`);

  const failures = await runWithInstance(instance, async () => {
    const db = createClient(instance.supabaseUrl, instance.supabaseServiceKey);
    const { data: co, error } = await db
      .from("companies")
      .select("id, name, timezone")
      .eq("name", company)
      .is("deleted_at", null)
      .maybeSingle<{ id: string; name: string; timezone: string | null }>();
    if (error) fail(`Could not read companies: ${error.message}`);
    if (!co) fail(`No company named "${company}" on this instance.`);

    const week = targetWeekEnding(co.timezone ?? "America/Anchorage");
    const measures = await loadMappedMeasures(db, co.id);
    console.log(`  company:  ${co.name}, ${measures.length} mapped measure(s), reading for the week ending ${week}\n`);
    const reader = googleSheetReader(co.id);
    let failed = 0;
    for (const m of measures) {
      if (!m.mapping) {
        failed += 1;
        console.log(`  FAIL  ${m.description}: the mapping does not parse`);
        continue;
      }
      const d = await runPull({ google_sheet: reader, hubspot: hubspotReader(co.id) }, m.mapping, week, co.timezone ?? "America/Anchorage");
      if (d.outcome === "written") console.log(`  OK    ${m.description}: ${d.value}  (${describeMapping(m.mapping)})`);
      else if (d.outcome === "skipped_stale") console.log(`  STALE ${m.description}: the sheet says it is not up to date for this week`);
      else {
        failed += 1;
        console.log(`  FAIL  ${m.description}: ${failureSentence(d.reason)}`);
      }
    }
    return failed;
  });
  console.log(failures === 0 ? "\n  Every mapped measure read. Nothing was written.\n" : `\n  ${failures} could not be read. Nothing was written.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

if (isEntryPoint(import.meta.url)) {
  void main();
}
