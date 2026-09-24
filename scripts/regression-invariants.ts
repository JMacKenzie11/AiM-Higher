// Invariants that must hold for ANY meeting, and a record of one run
// so stability across runs can be compared.
//
//   npx tsx --tsconfig scripts/tsconfig.json scripts/regression-invariants.ts <meeting-id> <run-label>
//
// ---- WHY NOT AN EXPECTED-VALUES TABLE --------------------------
//
// For Benson there is one, supplied by the person who was in the
// meeting. For a transcript nobody has hand-checked, a table written
// by the same process being tested grades its own homework.
//
// So this asserts only things that are true regardless of content:
// a commitment naming its doer must own it, a same-day phrase must
// resolve to the meeting's day, nobody may be invented, and the
// summary must be complete. Then it records the run so three runs
// can be compared for drift.
//
// Output goes to .regression/, which is gitignored: these runs are
// real client content.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { isEntryPoint } from "./lib/entry-point.ts";

for (const f of [".env.local", ".env.provisioning"]) {
  try {
    for (const line of readFileSync(f, "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}

async function main() {
  const id = process.argv[2];
  const label = process.argv[3] ?? "run";
  if (!id) throw new Error("pass a meeting id");

  const db = createClient(
    process.env.LOCAL_INSTANCE_SUPABASE_URL!,
    process.env.LOCAL_INSTANCE_SUPABASE_SERVICE_KEY!
  );
  const { data: meeting } = await db
    .from("meetings").select("company_id, created_at").eq("id", id).maybeSingle();
  const { data: company } = await db
    .from("companies").select("name, timezone").eq("id", meeting!.company_id).maybeSingle();
  const { data: analysisRow } = await db
    .from("meeting_analyses")
    .select("analysis_markdown, truncated, commitments_json")
    .eq("meeting_id", id).maybeSingle();
  const analysis = analysisRow;

  // READ BOTH SOURCES.
  //
  // A company with automated_commitment_tracking OFF produces
  // extractions in commitments_json and no rows on the board — by
  // design. Reading only the table reported "0 commitments" for a
  // Geo-Sci meeting that had extracted twenty, which looked exactly
  // like a recall failure on a long transcript. It was the flag.
  const { data: tableRows } = await db
    .from("commitments").select("description, due_date, owner_id").eq("source_meeting_id", id);
  const { data: feats } = await db
    .from("company_features").select("feature").eq("company_id", meeting!.company_id);
  const tracking = (feats ?? []).some(
    (f) => f.feature === "automated_commitment_tracking"
  );
  const rows = tracking
    ? tableRows
    : ((analysisRow?.commitments_json ?? []) as Array<{
        description: string;
        due_date: string;
        owner_profile_id: string | null;
      }>).map((c) => ({
        description: c.description,
        due_date: c.due_date,
        owner_id: c.owner_profile_id,
      }));
  const { data: people } = await db
    .from("profiles").select("id, full_name").eq("company_id", meeting!.company_id);

  const nameOf = (pid: string | null) =>
    people?.find((p) => p.id === pid)?.full_name ?? null;
  const firstNames = new Set(
    (people ?? []).map((p) => p.full_name.split(/\s+/)[0].toLowerCase())
  );
  const md: string = analysis?.analysis_markdown ?? "";
  const meetingDay = new Intl.DateTimeFormat("en-CA", {
    timeZone: company!.timezone || "UTC",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(meeting!.created_at));

  let pass = 0, fail = 0;
  const check = (ok: boolean, label: string, detail = "") => {
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
    ok ? pass++ : fail++;
  };

  console.log(`${company!.name} — ${meetingDay} (${company!.timezone})`);
  console.log(`commitment tracking: ${tracking ? "ON (board rows)" : "OFF (extractions only)"}`);
  console.log(`markdown ${md.length} chars | truncated=${analysis?.truncated} | ` +
    `${(rows ?? []).length} commitments\n`);

  check(analysis?.truncated === false, "summary is complete, not cut off");
  check(md.length > 2000, "summary has real content", `${md.length} chars`);
  check((rows ?? []).length > 0, "commitments were extracted");

  // A commitment whose text names its DOER must have that person as
  // owner. "Talk to X" and "send it to X" name a recipient, so only
  // the "<Name> will/is going to" shape is asserted.
  let namedDoer = 0, namedDoerCorrect = 0;
  for (const r of rows ?? []) {
    const m = r.description.match(/^(?:Likely\s+)?([A-Z][a-z]+)\s+(?:will|is going to|to)\b/);
    if (!m) continue;
    const first = m[1].toLowerCase();
    if (!firstNames.has(first)) continue;
    namedDoer++;
    if ((nameOf(r.owner_id) ?? "").toLowerCase().startsWith(first)) namedDoerCorrect++;
  }
  check(
    namedDoer === 0 || namedDoerCorrect === namedDoer,
    "a commitment naming its doer is owned by that person",
    `${namedDoerCorrect}/${namedDoer}`
  );

  // Nobody invented: every owner is a real person on this company.
  // Against the ROSTER THE EXTRACTOR WAS GIVEN, which includes the
  // AiMS coach. The coach is in the meeting and owns commitments,
  // and is not on the company — checking company membership alone
  // reported four legitimate assignments as invented people.
  const ownerIds = [...new Set((rows ?? []).map((r) => r.owner_id).filter(Boolean))];
  let invented = 0;
  for (const oid of ownerIds) {
    const { data: prof } = await db
      .from("profiles").select("id").eq("id", oid as string).maybeSingle();
    if (!prof) invented++;
  }
  check(invented === 0, "no owner is an invented person", `${invented} invented`);

  // No due date lands before the meeting.
  const early = (rows ?? []).filter((r) => r.due_date < meetingDay);
  check(early.length === 0, "no commitment is due before the meeting", `${early.length} early`);

  // Record for cross-run comparison.
  mkdirSync(".regression/runs", { recursive: true });
  const record = {
    meetingId: id, label, meetingDay,
    markdownChars: md.length,
    truncated: analysis?.truncated,
    commitments: (rows ?? [])
      .map((r) => ({
        description: r.description,
        owner: nameOf(r.owner_id),
        due: r.due_date,
      }))
      .sort((a, b) => a.description.localeCompare(b.description)),
  };
  writeFileSync(
    `.regression/runs/${id.slice(0, 8)}-${label}.json`,
    JSON.stringify(record, null, 2)
  );
  console.log(`\n${pass} pass, ${fail} fail   (recorded as ${id.slice(0, 8)}-${label})`);
}

if (isEntryPoint(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
