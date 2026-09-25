// SUMMARY-ONLY RE-ANALYSIS of one meeting.
//
//   npx tsx --tsconfig scripts/tsconfig.json scripts/resummarize-once.ts <instance> <meeting-id>
//   ... --apply     to actually write
//   ... --dev       target the dev clone (LOCAL_INSTANCE_*) instead of a registered instance;
//                   <instance> is then ignored and may be "dev"
//
// Without --apply it reads, reports, and changes nothing.
//
// ---- WHAT IT REGENERATES, AND WHAT IT LEAVES ALONE --------------
//
// Regenerated: the meeting_analyses row. The summary, the coaching
// notes, the questions, the coverage check and the score.
//
// Left exactly as it is: every commitment and every issue created
// from the meeting, and the analysis's own extracted lists
// (commitments_json, issues_json), which are carried over unchanged
// (analyzeMeeting's carryOver). Carrying the lists matters as much as
// sparing the rows: the page matches "already added" work by exact
// text, so a regenerated list with new wording would offer Add again
// on things already on somebody's list, and one click would duplicate
// them. No Guide nudge is raised and no analytics event fires.
//
// Reanalyze, the button, is for meetings with none of that work; it
// refuses any meeting that has commitments or issues (#321).
//
// ---- PROVEN, NOT ASSUMED ----------------------------------------
//
// Before and after, it reads every commitment and issue sourced from
// the meeting, soft-deleted ones included, and compares the id sets
// AND each row's updated_at, so a row rewritten in place is caught as
// surely as one deleted or added. It also checks the carried lists
// came back byte for byte. Any difference exits non-zero, loudly.
//
// The analysis row has to be deleted before the pipeline can write a
// new one (meeting_id is unique). If the regeneration fails, the old
// row is put back, so a failed run never leaves a meeting with no
// analysis.
//
// ---- WHERE IT MAY RUN ------------------------------------------
//
// Production and any live instance only on Jason's explicit go, per
// run (CLAUDE.md). The dry run reads only.

import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { runWithInstance } from "@/lib/instances/context";
import { analyzeMeeting } from "@/lib/transcripts/analyze";
import { lookupInstance } from "@/lib/instances/registry";
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

const DEV_REF = "dnaixuozuoapvexxzloj";

function fail(msg: string): never {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
}

export type RowStamp = { id: string; updated_at: string | null };

// What changed between two reads of the same meeting's rows. Pure, so
// the comparison that decides "untouched" is tested on its own.
export function diffRows(
  before: readonly RowStamp[],
  after: readonly RowStamp[]
): { added: string[]; removed: string[]; changed: string[] } {
  const b = new Map(before.map((r) => [r.id, r.updated_at]));
  const a = new Map(after.map((r) => [r.id, r.updated_at]));
  return {
    added: [...a.keys()].filter((id) => !b.has(id)),
    removed: [...b.keys()].filter((id) => !a.has(id)),
    changed: [...a.keys()].filter((id) => b.has(id) && b.get(id) !== a.get(id)),
  };
}

export function isUntouched(d: ReturnType<typeof diffRows>): boolean {
  return d.added.length === 0 && d.removed.length === 0 && d.changed.length === 0;
}

async function readWork(db: SupabaseClient, meetingId: string) {
  const [c, i] = await Promise.all([
    db.from("commitments").select("id, updated_at").eq("source_meeting_id", meetingId),
    db.from("issues").select("id, updated_at").eq("source_meeting_id", meetingId),
  ]);
  if (c.error || i.error) fail(`Could not read commitments/issues: ${c.error?.message ?? i.error?.message}`);
  return {
    commitments: (c.data ?? []) as RowStamp[],
    issues: (i.data ?? []) as RowStamp[],
  };
}

async function resolveTarget(args: string[]): Promise<{ label: string; instance: InstanceConfig }> {
  if (args.includes("--dev")) {
    const url = process.env.LOCAL_INSTANCE_SUPABASE_URL;
    const key = process.env.LOCAL_INSTANCE_SUPABASE_SERVICE_KEY;
    const anon = process.env.LOCAL_INSTANCE_SUPABASE_ANON_KEY;
    if (!url || !key || !anon) fail("LOCAL_INSTANCE_SUPABASE_* are not set.");
    if (!url.includes(DEV_REF)) fail(`--dev but LOCAL_INSTANCE_SUPABASE_URL is not the dev clone: ${url}`);
    return {
      label: "dev clone",
      instance: {
        subdomain: "dev-clone",
        displayName: "Dev clone (summary-only)",
        supabaseUrl: url,
        supabaseAnonKey: anon,
        supabaseServiceKey: key,
        status: "active",
      },
    };
  }
  const subdomain = args.filter((a) => !a.startsWith("--"))[0];
  const instance = subdomain ? await lookupInstance(subdomain) : null;
  if (!instance) fail(`No instance "${subdomain}" in the registry.`);
  return { label: subdomain!, instance };
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const apply = args.includes("--apply");
  const positional = args.filter((a) => !a.startsWith("--"));
  const meetingId = positional[1];
  if (!positional[0] || !meetingId) {
    fail("Usage: resummarize-once.ts <instance-subdomain | dev> <meeting-id> [--dev] [--apply]");
  }
  const { label, instance } = await resolveTarget(args);
  const db = createClient(instance.supabaseUrl, instance.supabaseServiceKey);

  const { data: meeting } = await db
    .from("meetings")
    .select("id, company_id, meeting_title, created_at, status")
    .eq("id", meetingId)
    .maybeSingle();
  if (!meeting) fail("Meeting not found on that instance.");
  const { data: company } = await db.from("companies").select("name").eq("id", meeting.company_id).maybeSingle();
  const { data: previous } = await db.from("meeting_analyses").select("*").eq("meeting_id", meetingId).maybeSingle();
  if (!previous) fail("This meeting has no analysis to regenerate. Nothing to carry over.");
  const before = await readWork(db, meetingId);

  console.log(`\n  target:      ${label}`);
  console.log(`  database:    ${instance.supabaseUrl}`);
  console.log(`  company:     ${company?.name}`);
  console.log(`  meeting:     ${meeting.meeting_title} (${String(meeting.created_at).slice(0, 10)})`);
  console.log(`  analysis:    ${previous.analysis_markdown.length} chars, written ${String(previous.created_at).slice(0, 16)}`);
  console.log(`  commitments: ${before.commitments.length} rows, WILL NOT BE TOUCHED`);
  console.log(`  issues:      ${before.issues.length} rows, WILL NOT BE TOUCHED`);
  console.log(`  carried:     ${(previous.commitments_json ?? []).length} extracted commitments, ${(previous.issues_json ?? []).length} extracted issues, unchanged`);

  if (!apply) {
    console.log("\n  Read only. Pass --apply to regenerate the summary.\n");
    return;
  }

  console.log("\n  regenerating…");
  const carryOver = {
    commitments_json: previous.commitments_json ?? [],
    issues_json: previous.issues_json ?? null,
  };
  const { error: delErr } = await db.from("meeting_analyses").delete().eq("meeting_id", meetingId);
  if (delErr) fail(`Could not clear the old analysis: ${delErr.message}`);
  await db.from("meetings").update({ status: "pending", error: null }).eq("id", meetingId);

  try {
    await runWithInstance(instance, () => analyzeMeeting(meetingId, { carryOver }));
  } catch (err) {
    // Put the old analysis back. A failed regeneration must not leave
    // the meeting with none.
    const { error: restoreErr } = await db.from("meeting_analyses").insert(previous);
    await db.from("meetings").update({ status: "complete", error: null }).eq("id", meetingId);
    fail(
      `Regeneration failed (${err instanceof Error ? err.message : err}). ` +
        (restoreErr ? `RESTORE ALSO FAILED: ${restoreErr.message}` : "The previous analysis was restored.")
    );
  }

  // Read back. "No error" is not evidence.
  const { data: after } = await db
    .from("meeting_analyses")
    .select("analysis_markdown, truncated, coverage_json, commitments_json, issues_json, score_overall")
    .eq("meeting_id", meetingId)
    .maybeSingle();
  const afterWork = await readWork(db, meetingId);
  const commitmentDiff = diffRows(before.commitments, afterWork.commitments);
  const issueDiff = diffRows(before.issues, afterWork.issues);
  const listsCarried =
    !!after &&
    JSON.stringify(after.commitments_json ?? []) === JSON.stringify(carryOver.commitments_json) &&
    JSON.stringify(after.issues_json ?? null) === JSON.stringify(carryOver.issues_json);

  const show = (d: ReturnType<typeof diffRows>) =>
    isUntouched(d)
      ? "unchanged: same ids, same updated_at"
      : `CHANGED: +${d.added.length} -${d.removed.length} ~${d.changed.length} ${JSON.stringify(d)}`;
  console.log(`\n  summary:     ${after ? `${after.analysis_markdown.length} chars, truncated=${after.truncated}` : "NOT WRITTEN"}`);
  console.log(`  score:       ${after?.score_overall ?? "none"}`);
  console.log(`  commitments: ${afterWork.commitments.length} rows, ${show(commitmentDiff)}`);
  console.log(`  issues:      ${afterWork.issues.length} rows, ${show(issueDiff)}`);
  console.log(`  carried:     ${listsCarried ? "extracted lists identical" : "EXTRACTED LISTS DIFFER"}`);
  if (!after || !isUntouched(commitmentDiff) || !isUntouched(issueDiff) || !listsCarried) {
    fail("Something other than the summary changed. Investigate before doing anything else.");
  }
  console.log("");
}

if (isEntryPoint(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
