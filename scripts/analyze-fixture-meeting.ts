// Run the REAL summariser against the fixture company on the dev clone.
//
//   npm run fixture:analyze
//   npm run fixture:analyze -- --keep   (leave the previous summary in place)
//
// ---- WHY THIS EXISTS -------------------------------------------
//
// `npm run seed:e2e` writes a meeting_analyses row by hand — the
// summary text is a string literal in that script and `model` is
// 'e2e-fixture'. Nothing generates it. So reseeding can never test
// anything about the summariser: its prompt, its voice rules, its
// commitment extraction, its facilitation review. You would be
// reading the seed script's own prose back.
//
// This runs the pipeline for real: speaker mapping, the analysis
// call, extraction, the facilitation review, the coverage check, and
// the Guide nudge at the end. Everything a client's meeting goes
// through, against a company with no client data in it.
//
// ---- WHY NOT BENSON --------------------------------------------
//
// Benson's transcript is real client content and their meeting on
// the dev clone is a copy of a real one. Testing against it works
// and costs something: every run rewrites a real company's summary,
// even on a clone, and the transcript cannot be committed. The
// fixture transcript in scripts/fixtures/ is invented, lives in the
// repo, and is deliberately messy in the ways that have actually
// broken this pipeline — speaker labels rather than names, a person
// who is not on the roster, a decision reversed mid-meeting, three
// different shapes of deadline, and one idle musing that must NOT
// become a commitment.
//
// ---- DEV ONLY, CHECKED ------------------------------------------
//
// Reads LOCAL_INSTANCE_* and refuses to run if that resolves to the
// production database or to any registered instance. The registry
// has no dev entry, so the ordinary instance lookup cannot reach the
// clone at all — which is the reason this script builds its own
// config rather than calling lookupInstance.

import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { runWithInstance } from "@/lib/instances/context";
import { analyzeMeeting } from "@/lib/transcripts/analyze";
import type { InstanceConfig } from "@/lib/instances/types";
import { isEntryPoint } from "./lib/entry-point.ts";

for (const f of [".env.provisioning", ".env.local"]) {
  try {
    for (const line of readFileSync(f, "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}

const COMPANY_NAME = "E2E Fixture Co";
const FIXTURE_FOLDER = "e2e-guide-fixture-folder";
const FILE_NAME = "e2e-fixture-leadership-meeting.txt";

function fail(msg: string): never {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
}

// Every URL this script must never write to. Compared by project
// ref rather than by string, so a trailing slash or a pooler host
// cannot sneak one past.
function ref(url: string | undefined): string | null {
  if (!url) return null;
  return /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(url)?.[1] ?? url;
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const keep = args.includes("--keep");

  const url = process.env.LOCAL_INSTANCE_SUPABASE_URL;
  const key = process.env.LOCAL_INSTANCE_SUPABASE_SERVICE_KEY;
  const anon = process.env.LOCAL_INSTANCE_SUPABASE_ANON_KEY;
  if (!url || !key || !anon) {
    fail("LOCAL_INSTANCE_SUPABASE_URL / _SERVICE_KEY / _ANON_KEY are not set.");
  }

  // ---- THE GUARD ------------------------------------------------
  //
  // The forbidden set is every database the CONTROL-PLANE REGISTRY
  // serves real users from, resolved through the same env prefixes
  // the app uses, plus production's own variables.
  //
  // The first version forbade every other *_SUPABASE_URL in the
  // environment, and refused to run: DEV_SUPABASE_URL is a second
  // name for the dev clone itself, so the guard fired on the very
  // database it was protecting. "Any other alias" is the wrong
  // question. "Is this a database people are served from" is the
  // right one, and the registry is what answers it.
  //
  // Reading the registry FAILS CLOSED. If the control plane cannot
  // be reached, this script does not know what it might be about to
  // overwrite, and a summary rewrite is not worth a guess.
  const cpUrl = process.env.CONTROL_PLANE_SUPABASE_URL;
  const cpKey = process.env.CONTROL_PLANE_SUPABASE_SERVICE_KEY;
  if (!cpUrl || !cpKey) {
    fail(
      "CONTROL_PLANE_SUPABASE_URL / _SERVICE_KEY are not set, so the live " +
        "instances cannot be listed and this cannot prove it is writing to " +
        "the dev clone. Refusing to run."
    );
  }
  const cp = createClient(cpUrl, cpKey);
  const { data: instances, error: registryError } = await cp
    .from("instances")
    .select("subdomain, env_prefix");
  if (registryError || !instances) {
    fail(`Could not read the instance registry (${registryError?.message ?? "no rows"}). Refusing to run.`);
  }

  const forbidden: Array<[string, string | undefined]> = [
    ["production", process.env.PROD_SUPABASE_URL],
    ["the app's public URL", process.env.NEXT_PUBLIC_SUPABASE_URL],
    ...instances.map(
      (i): [string, string | undefined] => [
        `the "${i.subdomain}" instance`,
        process.env[`${i.env_prefix}_SUPABASE_URL`],
      ]
    ),
  ];
  for (const [what, value] of forbidden) {
    if (value && ref(value) === ref(url)) {
      fail(
        `REFUSING TO RUN: LOCAL_INSTANCE_SUPABASE_URL is ${what}. This ` +
          `script rewrites a meeting summary and is for the dev clone only.`
      );
    }
  }

  const db = createClient(url, key);
  const { data: company, error: companyError } = await db
    .from("companies")
    .select("id, name, timezone")
    .eq("name", COMPANY_NAME)
    .maybeSingle<{ id: string; name: string; timezone: string }>();
  if (companyError) fail(companyError.message);
  if (!company) fail(`No "${COMPANY_NAME}" on this database. Run npm run seed:e2e first.`);

  const transcript = readFileSync(
    path.join(process.cwd(), "scripts", "fixtures", "leadership-meeting.txt"),
    "utf8"
  );

  const { data: source, error: sourceError } = await db
    .from("transcript_sources")
    .select("id")
    .eq("folder_id", FIXTURE_FOLDER)
    .maybeSingle<{ id: string }>();
  if (sourceError) fail(sourceError.message);
  if (!source) fail("The fixture transcript source is missing. Run npm run seed:e2e first.");

  // One meeting, reused. Deleting and recreating would change the
  // meeting id every run, and the nudge, the commitments and any
  // conversation pinned to it all hang off that id.
  const { data: existing } = await db
    .from("meetings")
    .select("id")
    .eq("source_id", source.id)
    .eq("file_name", FILE_NAME)
    .maybeSingle<{ id: string }>();

  let meetingId: string;
  if (existing) {
    meetingId = existing.id;
    const { error } = await db
      .from("meetings")
      .update({ transcript_text: transcript, status: "pending", error: null })
      .eq("id", meetingId);
    if (error) fail(error.message);
  } else {
    const { data: created, error } = await db
      .from("meetings")
      .insert({
        company_id: company.id,
        source_id: source.id,
        provider_file_id: `e2e-fixture-analysis`,
        file_name: FILE_NAME,
        content_hash: "e2e-fixture-analysis",
        meeting_title: "Weekly Leadership Meeting",
        transcript_text: transcript,
        status: "pending",
      })
      .select("id")
      .single<{ id: string }>();
    if (error || !created) fail(error?.message ?? "meeting insert returned nothing");
    meetingId = created.id;
  }

  // Cleared unless --keep, so a rerun is a fresh read rather than a
  // second summary layered on the first. The commitments go too:
  // this company's automated_commitment_tracking is ON, so leaving
  // them would accumulate a new set on every run.
  if (!keep) {
    await db.from("meeting_analyses").delete().eq("meeting_id", meetingId);
    await db.from("commitments").delete().eq("source_meeting_id", meetingId);
  }

  const instance: InstanceConfig = {
    subdomain: "dev-clone",
    displayName: "Dev clone (fixture analysis)",
    supabaseUrl: url,
    supabaseAnonKey: anon,
    supabaseServiceKey: key,
    status: "active",
  };

  console.log(`\n  database:  ${url}`);
  console.log(`  company:   ${company.name} (${company.timezone})`);
  console.log(`  meeting:   ${meetingId}`);
  console.log(`  transcript:${transcript.length} chars`);
  console.log(`\n  analysing for real…\n`);

  await runWithInstance(instance, async () => {
    await analyzeMeeting(meetingId);
  });

  // Read back. "No error" is not evidence.
  const { data: analysis } = await db
    .from("meeting_analyses")
    .select("analysis_markdown, truncated, coverage_json, model")
    .eq("meeting_id", meetingId)
    .maybeSingle<{
      analysis_markdown: string;
      truncated: boolean;
      coverage_json: { missed?: unknown[] } | null;
      model: string;
    }>();
  if (!analysis) fail("No summary was written. Check the log above.");

  const { data: commitments } = await db
    .from("commitments")
    .select("description, due_date, owner_id")
    .eq("source_meeting_id", meetingId);
  const { data: nudge } = await db
    .from("guide_nudges")
    .select("state, headline")
    .eq("company_id", company.id)
    .order("raised_at", { ascending: false })
    .limit(1);

  console.log(`\n  model:       ${analysis.model}`);
  console.log(`  summary:     ${analysis.analysis_markdown.length} chars, truncated=${analysis.truncated}`);
  console.log(`  coverage:    ${analysis.coverage_json?.missed?.length ?? 0} possible miss(es)`);
  console.log(`  commitments: ${(commitments ?? []).length}`);
  for (const c of commitments ?? []) {
    console.log(`    - ${c.due_date ?? "no date"}  ${c.description.slice(0, 70)}`);
  }
  console.log(`  nudge:       ${nudge?.[0] ? `${nudge[0].state} — "${nudge[0].headline}"` : "none raised"}`);
  console.log(`\n  Read it at /leadership/meetings/${meetingId}\n`);
}

if (isEntryPoint(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
