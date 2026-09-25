// A COMPANY'S SPELLINGS: list them, or add one.
//
//   npx tsx --tsconfig scripts/tsconfig.json scripts/spellings.ts <instance | dev> <company-id>
//   ... --set "Grand Manan=Graham and Ann|Grand Menan" [--kind place|supplier|person|term]
//   ... --set "Kylie="            a name correct as it stands: never corrected
//   ... --dev                     the dev clone (LOCAL_INSTANCE_*) instead of a registered instance
//   ... --apply                   actually write
//
// Without --apply it prints what is there and what would change, and
// writes nothing. The list is read by the meeting pipeline
// (src/lib/transcripts/spelling.ts, migration 0237). No screen edits
// it: it is short, it changes rarely, and each entry is a judgement
// about one client's words.
//
// A write to a live database, dev included, runs only on Jason's go
// for that run (CLAUDE.md).

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { lookupInstance } from "@/lib/instances/registry";
import { isEntryPoint } from "./lib/entry-point.ts";

for (const f of [".env.provisioning", ".env.local"]) {
  try {
    for (const line of readFileSync(f, "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}

const DEV_REF = "dnaixuozuoapvexxzloj";
const KINDS = ["place", "supplier", "person", "term"] as const;

function fail(msg: string): never {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
}

// "Grand Manan=Graham and Ann|Grand Menan" -> spelling + heard_as.
export function parseSet(arg: string): { spelling: string; heard_as: string[] } {
  const eq = arg.indexOf("=");
  if (eq < 0) throw new Error(`--set needs "Spelling=heard as|heard as", got "${arg}"`);
  const spelling = arg.slice(0, eq).trim();
  if (spelling.length < 2) throw new Error("the spelling is empty");
  const heard_as = arg
    .slice(eq + 1)
    .split("|")
    .map((h) => h.trim())
    .filter((h) => h.length > 0);
  return { spelling, heard_as };
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const apply = args.includes("--apply");
  const setArg = flag(args, "--set");
  const kind = flag(args, "--kind") ?? "place";
  if (!(KINDS as readonly string[]).includes(kind)) fail(`--kind must be one of ${KINDS.join(", ")}`);
  const positional = args.filter(
    (a, i) => !a.startsWith("--") && args[i - 1] !== "--set" && args[i - 1] !== "--kind"
  );
  const [target, companyId] = positional;
  if (!target || !companyId) fail("Usage: spellings.ts <instance | dev> <company-id> [--set ...] [--dev] [--apply]");

  let url: string;
  let key: string;
  if (args.includes("--dev")) {
    url = process.env.LOCAL_INSTANCE_SUPABASE_URL ?? "";
    key = process.env.LOCAL_INSTANCE_SUPABASE_SERVICE_KEY ?? "";
    if (!url.includes(DEV_REF)) fail(`--dev but LOCAL_INSTANCE_SUPABASE_URL is not the dev clone: ${url}`);
  } else {
    const instance = await lookupInstance(target);
    if (!instance) fail(`No instance "${target}" in the registry.`);
    url = instance.supabaseUrl;
    key = instance.supabaseServiceKey;
  }
  const db = createClient(url, key);

  const { data: company } = await db.from("companies").select("name").eq("id", companyId).maybeSingle();
  if (!company) fail("No such company on that database.");
  const { data: rows, error } = await db
    .from("company_spellings")
    .select("spelling, heard_as, kind")
    .eq("company_id", companyId)
    .order("spelling");
  if (error) fail(`Could not read company_spellings: ${error.message}`);

  console.log(`\n  database: ${url}`);
  console.log(`  company:  ${company.name}`);
  console.log(`  entries:  ${rows!.length}`);
  for (const r of rows!) {
    console.log(`    ${r.spelling} (${r.kind}) <- ${r.heard_as.length ? r.heard_as.join(" | ") : "(correct as it stands)"}`);
  }
  if (!setArg) return console.log("");

  const next = parseSet(setArg);
  const existing = rows!.find((r) => r.spelling === next.spelling);
  console.log(
    `\n  ${existing ? "replace" : "add"}: ${next.spelling} (${kind}) <- ` +
      `${next.heard_as.length ? next.heard_as.join(" | ") : "(correct as it stands)"}`
  );
  if (!apply) return console.log("\n  Read only. Pass --apply to write.\n");

  const { error: writeErr } = await db
    .from("company_spellings")
    .upsert({ company_id: companyId, spelling: next.spelling, heard_as: next.heard_as, kind }, { onConflict: "company_id,spelling" });
  if (writeErr) fail(`Write failed: ${writeErr.message}`);
  // Read back. "No error" is not evidence.
  const { data: back } = await db
    .from("company_spellings")
    .select("spelling, heard_as")
    .eq("company_id", companyId)
    .eq("spelling", next.spelling)
    .maybeSingle();
  if (!back || JSON.stringify(back.heard_as) !== JSON.stringify(next.heard_as)) fail("Read-back does not match.");
  console.log("  written and read back.\n");
}

if (isEntryPoint(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
