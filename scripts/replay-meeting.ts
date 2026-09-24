// One-off: replay a production transcript through the CURRENT code,
// writing the result to the dev clone.
//
// Read-only against production. Every write lands on dev.
//
//   npx tsx --tsconfig scripts/tsconfig.json scripts/replay-meeting.ts <prod-meeting-id>
//
// Why a script and not the Reanalyze button: the button reanalyzes
// the meeting where it lives, which is production. This copies the
// transcript to dev first, so the new prompt can be seen without
// touching a customer's page or their live commitments.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { isEntryPoint } from "./lib/entry-point.ts";
import { runWithInstance } from "@/lib/instances/context";
import { analyzeMeeting } from "@/lib/transcripts/analyze";
import type { InstanceConfig } from "@/lib/instances/types";

for (const f of [".env.local", ".env.provisioning"]) {
  try {
    for (const line of readFileSync(f, "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // already in the environment
  }
}

const PROD_ID = process.argv[2];
if (!PROD_ID) throw new Error("pass the production meeting id");

const dev: InstanceConfig = {
  subdomain: "dev",
  displayName: "Dev clone",
  supabaseUrl: process.env.LOCAL_INSTANCE_SUPABASE_URL!,
  supabaseAnonKey: process.env.LOCAL_INSTANCE_SUPABASE_ANON_KEY!,
  supabaseServiceKey: process.env.LOCAL_INSTANCE_SUPABASE_SERVICE_KEY!,
  status: "active",
};

const prod = createClient(
  process.env.PROD_SUPABASE_URL!,
  process.env.PROD_SUPABASE_SERVICE_KEY!
);
const devDb = createClient(dev.supabaseUrl, dev.supabaseServiceKey);

async function main() {
  // ---- read production, and nothing else ----------------------
  const { data: meeting } = await prod
    .from("meetings")
    .select("*")
    .eq("id", PROD_ID)
    .maybeSingle();
  if (!meeting) throw new Error("meeting not found on production");

  const { data: prodCo } = await prod
    .from("companies")
    .select("id, name")
    .eq("id", meeting.company_id)
    .maybeSingle();
  const { data: prodFoundation } = await prod
    .from("company_foundation")
    .select("*")
    .eq("company_id", meeting.company_id)
    .maybeSingle();

  console.log(`source: ${prodCo?.name} — "${meeting.meeting_title}"`);
  console.log(`        transcript ${meeting.transcript_text.length} chars\n`);

  // ---- find the same company on dev ---------------------------
  const { data: devCo } = await devDb
    .from("companies")
    .select("id, name")
    .ilike("name", prodCo!.name)
    .maybeSingle();
  if (!devCo) throw new Error(`no company named "${prodCo!.name}" on dev`);

  // Core values, because the Core Values in Action section is
  // omitted entirely without them and it is the section most worth
  // looking at. Only this field, only when dev has none.
  const { data: devFoundation } = await devDb
    .from("company_foundation")
    .select("company_id, core_values")
    .eq("company_id", devCo.id)
    .maybeSingle();
  if (prodFoundation?.core_values && !devFoundation?.core_values) {
    if (devFoundation) {
      await devDb
        .from("company_foundation")
        .update({ core_values: prodFoundation.core_values })
        .eq("company_id", devCo.id);
    } else {
      await devDb
        .from("company_foundation")
        .insert({ company_id: devCo.id, core_values: prodFoundation.core_values });
    }
    console.log("copied core values to dev (they were absent)\n");
  }

  // ---- stage the meeting on dev -------------------------------
  const devMeetingId = PROD_ID; // same id, so it is traceable
  await devDb.from("meeting_analyses").delete().eq("meeting_id", devMeetingId);
  await devDb.from("commitments").delete().eq("source_meeting_id", devMeetingId);
  await devDb.from("issues").delete().eq("source_meeting_id", devMeetingId);
  await devDb.from("meetings").delete().eq("id", devMeetingId);
  const { error: insErr } = await devDb.from("meetings").insert({
    id: devMeetingId,
    company_id: devCo.id,
    transcript_text: meeting.transcript_text,
    meeting_title: meeting.meeting_title,
    file_name: meeting.file_name,
    source: meeting.source,
    // NOT NULL on meetings, and it is the ingest source's own id.
    // Suffixed so this replay can never be mistaken for, or collide
    // with, a real ingested file on dev.
    provider_file_id: `replay:${PROD_ID}`,
    // The ORIGINAL date. Due-date anchors ("later today", "end of
    // the month") and the meeting+7 floor all resolve against
    // created_at, so a staged copy dated today produces dates that
    // can never match what the meeting actually said.
    created_at: meeting.created_at,
    // Also NOT NULL. The real value is the ingest dedupe key; the
    // production row already has one computed from this transcript,
    // so carry it rather than invent one.
    content_hash: meeting.content_hash,
    status: "pending",
  });
  if (insErr) throw new Error(`could not stage on dev: ${insErr.message}`);

  // ---- run the real pipeline, scoped to dev -------------------
  console.log("analysing against dev…");
  const t0 = Date.now();
  await runWithInstance(dev, async () => {
    await analyzeMeeting(devMeetingId);
  });
  console.log(`done in ${Math.round((Date.now() - t0) / 1000)}s\n`);

  // ---- read it back -------------------------------------------
  const { data: out } = await devDb
    .from("meeting_analyses")
    .select("analysis_markdown, truncated, facilitation_review_json, commitments_json")
    .eq("meeting_id", devMeetingId)
    .maybeSingle();
  if (!out) throw new Error("no analysis row was written");

  const md: string = out.analysis_markdown;
  console.log(`truncated: ${out.truncated}   markdown: ${md.length} chars`);
  console.log(`commitments extracted: ${(out.commitments_json ?? []).length}\n`);
  console.log("SECTIONS, in the order they were written:");
  for (const l of md.split("\n")) if (/^##\s/.test(l)) console.log("   " + l);

  const r = out.facilitation_review_json;
  if (r) {
    console.log(`\noverall: ${r.overall}/10`);
    for (const [k, v] of Object.entries(r.dimensions ?? {})) {
      console.log(`   ${k.padEnd(17)} ${(v as { score: number | null }).score}`);
    }
    console.log(`   agenda_adherence  ${r.agenda_adherence?.score_out_of_5}/5`);
    console.log(`\ngenerative questions found: ${(r.generative_questions ?? []).length}`);
    for (const q of r.generative_questions ?? []) console.log(`   "${q.quote}"`);
    console.log(`\n4Ws audit:`);
    for (const row of r.fourws_audit ?? []) {
      const t = (b: boolean) => (b ? "Y" : "-");
      console.log(`   [${t(row.has_what)}${t(row.has_want)}${t(row.has_way)}${t(row.has_who_when)}]  ${row.issue}`);
    }
    console.log(`\nexecutive summary:\n  ${r.executive_summary}`);
  }
}

// Runs only when this file IS the process entry point. Importing it
// must never execute it. See scripts/lib/entry-point.ts.
if (isEntryPoint(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
