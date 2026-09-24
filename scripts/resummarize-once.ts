// ONE-OFF: regenerate a single meeting's summary in place.
//
//   npx tsx --tsconfig scripts/tsconfig.json scripts/resummarize-once.ts <instance> <meeting-id>
//   ... --apply     to actually write
//
// Without --apply it reads and reports and changes nothing.
//
// ---- WHAT IT TOUCHES -------------------------------------------
//
// The meeting_analyses row, and nothing else. Commitments and
// issues are left exactly as they are — no delete, no re-create, no
// change of id, owner, date or wording. That is the difference
// between this and Reanalyze, which exists for when the EXTRACTION
// was wrong and deliberately replaces those rows.
//
// The meeting Jason wanted this for had 15 live commitments, 14 due
// that week, on a company with automated_commitment_tracking on.
// Reanalyze would have replaced all 15 underneath the people
// working from them.
//
// ---- WHY A SCRIPT AND NOT A BUTTON -----------------------------
//
// One real case gets a one-off. A second button beside Reanalyze,
// differing only in what it silently spares, is a thing somebody
// picks wrong under time pressure. If regenerating a summary turns
// out to be routine, that is the moment to design a surface for it.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { runWithInstance } from "@/lib/instances/context";
import { analyzeMeeting } from "@/lib/transcripts/analyze";
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

function fail(msg: string): never {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const apply = args.includes("--apply");
  const [subdomain, meetingId] = args.filter((a) => !a.startsWith("--"));
  if (!subdomain || !meetingId) {
    fail("Usage: resummarize-once.ts <instance-subdomain> <meeting-id> [--apply]");
  }

  const instance = await lookupInstance(subdomain);
  if (!instance) fail(`No instance "${subdomain}" in the registry.`);

  const db = createClient(instance.supabaseUrl, instance.supabaseServiceKey);
  const { data: meeting } = await db
    .from("meetings")
    .select("id, company_id, meeting_title, created_at, status")
    .eq("id", meetingId)
    .maybeSingle();
  if (!meeting) fail("Meeting not found on that instance.");
  const { data: company } = await db
    .from("companies").select("name").eq("id", meeting.company_id).maybeSingle();
  const { data: before } = await db
    .from("commitments").select("id, description, due_date, status")
    .eq("source_meeting_id", meetingId);
  const { data: analysis } = await db
    .from("meeting_analyses").select("created_at, analysis_markdown")
    .eq("meeting_id", meetingId).maybeSingle();

  console.log(`\n  instance:    ${subdomain}`);
  console.log(`  database:    ${instance.supabaseUrl}`);
  console.log(`  company:     ${company?.name}`);
  console.log(`  meeting:     ${meeting.meeting_title} (${meeting.created_at.slice(0, 10)})`);
  console.log(`  analysis:    ${analysis ? `${analysis.analysis_markdown.length} chars, written ${analysis.created_at.slice(0, 16)}` : "none"}`);
  console.log(`  commitments: ${(before ?? []).length} — THESE WILL NOT BE TOUCHED`);

  if (!apply) {
    console.log("\n  Read only. Pass --apply to regenerate the summary.\n");
    return;
  }

  console.log("\n  regenerating…");
  await db.from("meeting_analyses").delete().eq("meeting_id", meetingId);
  await db.from("meetings").update({ status: "pending", error: null }).eq("id", meetingId);
  await runWithInstance(instance, async () => {
    await analyzeMeeting(meetingId, { preserveCommitments: true });
  });

  // Read back. "No error" is not evidence.
  const { data: after } = await db
    .from("meeting_analyses").select("analysis_markdown, truncated, coverage_json")
    .eq("meeting_id", meetingId).maybeSingle();
  const { data: stillThere } = await db
    .from("commitments").select("id, description, due_date, status")
    .eq("source_meeting_id", meetingId);

  const beforeIds = new Set((before ?? []).map((c) => c.id));
  const afterIds = new Set((stillThere ?? []).map((c) => c.id));
  const same =
    beforeIds.size === afterIds.size &&
    [...beforeIds].every((id) => afterIds.has(id));

  console.log(`\n  summary:     ${after ? `${after.analysis_markdown.length} chars, truncated=${after.truncated}` : "NOT WRITTEN"}`);
  console.log(`  coverage:    ${after?.coverage_json ? `${(after.coverage_json as { missed?: unknown[] }).missed?.length ?? 0} possible miss(es)` : "not run"}`);
  console.log(`  commitments: ${(stillThere ?? []).length} — ${same ? "unchanged, same rows" : "CHANGED — investigate"}`);
  if (!same) process.exit(1);
  console.log("");
}

if (isEntryPoint(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
