// HOW STEADY IS THE RUBRIC SCORE? Scores real meetings from the dev
// clone several times each and reports, per meeting, the totals, the
// parts that moved between runs, the checks the readings split on, and
// the moments the model offered that the transcript does not contain.
//
// Reads only. Nothing is written to any database.
//
//   npm run eval:rubric -- <label> <outDir> [repeats=3] [meetingId ...]
//
// With no meeting ids, the latest few analysed team meetings with a
// real transcript. RUBRIC_READINGS=1 measures a single reading.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
for (const f of [".env.local", ".env.provisioning"]) {
  try {
    for (const line of readFileSync(f, "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}

const { createClient } = await import("@supabase/supabase-js");
const { default: Anthropic } = await import("@anthropic-ai/sdk");
const { runWithInstance } = await import("@/lib/instances/context");
const { loadCompanyContext, formatCompanyContext } = await import("@/lib/transcripts/analyze");
const { loadRubricFacts } = await import("@/lib/leadership/rubric/facts");
const { scoreMeeting, RUBRIC_READINGS } = await import("@/lib/leadership/rubric/score-meeting");
const { transcriptModel } = await import("@/lib/transcripts/model");

const label = process.argv[2] ?? "run";
const outDir = process.argv[3] ?? "rubric-eval";
const REPEATS = Number(process.argv[4] ?? 3);
const ids = process.argv.slice(5);
const READINGS = Number(process.env.RUBRIC_READINGS ?? RUBRIC_READINGS);
const MEETINGS = Number(process.env.RUBRIC_MEETINGS ?? 4);
const model = process.env.RUBRIC_MODEL ?? transcriptModel();

const dev = {
  subdomain: "dev",
  displayName: "Dev clone",
  supabaseUrl: process.env.LOCAL_INSTANCE_SUPABASE_URL!,
  supabaseAnonKey: process.env.LOCAL_INSTANCE_SUPABASE_ANON_KEY!,
  supabaseServiceKey: process.env.LOCAL_INSTANCE_SUPABASE_SERVICE_KEY!,
  status: "active" as const,
};
const db = createClient(dev.supabaseUrl, dev.supabaseServiceKey);
const client = new Anthropic();

type MeetingRow = { id: string; company_id: string; created_at: string; transcript_text: string; meeting_title: string | null };

async function pickMeetings(): Promise<MeetingRow[]> {
  if (ids.length > 0) {
    const { data } = await db.from("meetings").select("id, company_id, created_at, transcript_text, meeting_title").in("id", ids);
    return (data ?? []) as MeetingRow[];
  }
  // meetings-kind: an operator's eval, team meetings only.
  const { data } = await db
    .from("meetings")
    .select("id, company_id, created_at, transcript_text, meeting_title")
    .eq("kind", "team")
    .eq("status", "complete")
    .order("created_at", { ascending: false })
    .limit(40);
  const rows = ((data ?? []) as MeetingRow[]).filter((m) => m.company_id && m.transcript_text.length > 8000);
  // One per company first, so the eval sees different teams.
  const seen = new Set<string>();
  const picked: MeetingRow[] = [];
  for (const m of rows) if (!seen.has(m.company_id) && picked.length < MEETINGS) { seen.add(m.company_id); picked.push(m); }
  for (const m of rows) if (picked.length < MEETINGS && !picked.includes(m)) picked.push(m);
  return picked;
}

const report: unknown[] = [];
const lines: string[] = [`# Rubric eval: ${label}`, "", `model ${model}, ${READINGS} readings per score, ${REPEATS} scores per meeting`, ""];
let inTok = 0, outTok = 0, cacheRead = 0;

await runWithInstance(dev, async () => {
  const meetings = await pickMeetings();
  for (const m of meetings) {
    const ctx = await loadCompanyContext(db as never, m.company_id);
    const facts = await loadRubricFacts(db as never, {
      meetingId: m.id,
      companyId: m.company_id,
      createdAt: m.created_at,
      timezone: ctx.timezone ?? "UTC",
    });
    const runs = [];
    for (let i = 0; i < REPEATS; i++) {
      const run = await scoreMeeting(client, {
        model,
        transcript: m.transcript_text,
        contextBlock: formatCompanyContext(ctx),
        facts,
        readings: READINGS,
      });
      if (!run) { runs.push(null); continue; }
      for (const u of run.usage) { inTok += u.input_tokens; outTok += u.output_tokens; cacheRead += u.cache_read_input_tokens ?? 0; }
      runs.push(run);
      process.stdout.write(`${m.id.slice(0, 8)} run ${i + 1}: ${run.score.outOfTen}\n`);
    }
    const ok = runs.filter((r): r is NonNullable<typeof r> => r !== null);
    const partsMoved = ok.length
      ? ok[0].score.parts.filter((p, i) => ok.some((r) => r.score.parts[i].level !== p.level)).map((p) => `${p.name} (${ok.map((r) => r.score.parts.find((x) => x.key === p.key)!.level).join("/")})`)
      : [];
    const splits = new Map<string, number>();
    for (const r of ok) for (const id of r.score.split) splits.set(id, (splits.get(id) ?? 0) + 1);
    const rejected = new Map<string, number>();
    for (const r of ok) for (const id of r.momentsRejected) rejected.set(id, (rejected.get(id) ?? 0) + 1);
    const factsLine = `goals ${facts.goals.length}, last week's commitments ${facts.priorCommitments.length}, new ${facts.newCommitments.length}, measures ${facts.measures?.length ?? "none"}, areas ${facts.headlineAreas.length}`;
    lines.push(
      `## ${ctx.companyName}: ${m.meeting_title ?? m.id} (${m.created_at.slice(0, 10)})`,
      "",
      `- facts: ${factsLine}`,
      `- talk: ${ok[0] ? `${ok[0].counts.attendees} attendees, ${ok[0].counts.engaged} engaged, top share ${Math.round(ok[0].counts.topShare * 100)}%` : "n/a"}`,
      `- scores: ${runs.map((r) => (r ? `${r.score.outOfTen} (${r.score.parts.map((p) => p.level).join("")})` : "failed")).join(", ")}`,
      `- parts that moved: ${partsMoved.length ? partsMoved.join("; ") : "none"}`,
      `- checks the readings split on: ${[...splits].map(([k, v]) => `${k} x${v}`).join(", ") || "none"}`,
      `- moments not found in the transcript: ${[...rejected].map(([k, v]) => `${k} x${v}`).join(", ") || "none"}`,
      ""
    );
    if (ok[0]) {
      lines.push("First score, part by part:", "");
      for (const p of ok[0].score.parts) {
        lines.push(`**${p.name}: ${p.level}**`);
        for (const w of p.wins) lines.push(`  - + ${w.text}${w.moment ? ` ("${w.moment}")` : ""}`);
        for (const b of p.better) lines.push(`  - ^ ${b.text}`);
      }
      lines.push("");
    }
    report.push({ meeting: m.id, company: ctx.companyName, facts, runs: ok.map((r) => ({ score: r.score, results: r.results, momentsRejected: r.momentsRejected, counts: r.counts })) });
  }
});

lines.push(`tokens: input ${inTok}, cache read ${cacheRead}, output ${outTok}`);
mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/${label}.json`, JSON.stringify(report, null, 2));
writeFileSync(`${outDir}/${label}.md`, lines.join("\n"));
console.log(lines.join("\n"));
