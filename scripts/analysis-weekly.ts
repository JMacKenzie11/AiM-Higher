// What the meeting pipeline's two self-checks found, week by week.
//
//   npm run analysis:weekly              every active instance, last 6 weeks
//   npm run analysis:weekly -- --weeks 8
//
// Reads meeting_analyses and prints one line per company per week.
// Writes nothing.
//
// ---- THE TWO COLUMNS -------------------------------------------
//
// `flagged`: lines the coverage check (0234) says the extraction
// missed. It reports and never adds. Kept for a month from
// 2026-09-25 so Jason can decide whether it earns its call; this is
// the number that decision reads.
//
// `spelling`: corrections the spelling pass (0237, 0238) made. The
// pass is deterministic, so a wrong correction repeats in every
// meeting for that company. The distinct changes are printed under
// the table, words and all, so a wrong one on a new client is seen
// the first week rather than found in a summary months later.
//
// A meeting whose check did not run (coverage_json null, or
// spelling_changes null because it predates 0238) counts in `not run`,
// never as zero: "found nothing" and "did not look" are different
// answers.

import { readFileSync } from "node:fs";
import { forEachActiveInstance } from "@/lib/instances/for-each";
import { isEntryPoint } from "./lib/entry-point.ts";

for (const f of [".env.provisioning", ".env.local"]) {
  try {
    for (const line of readFileSync(f, "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}

export type AnalysisRow = {
  company_id: string;
  created_at: string;
  coverage_json: { missed?: unknown[] } | null;
  spelling_changes: Array<{ from: string; to: string; count: number }> | null;
};

type Week = {
  week: string;
  company_id: string;
  meetings: number;
  flagged: number;
  coverageNotRun: number;
  spelling: number;
  spellingNotRun: number;
  changes: Map<string, number>;
};

// Monday of the UTC week, as YYYY-MM-DD.
export function weekOf(iso: string): string {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day))
    .toISOString()
    .slice(0, 10);
}

export function summarise(rows: readonly AnalysisRow[]): Week[] {
  const weeks = new Map<string, Week>();
  for (const r of rows) {
    const week = weekOf(r.created_at);
    const key = `${week} ${r.company_id}`;
    const w =
      weeks.get(key) ??
      ({
        week,
        company_id: r.company_id,
        meetings: 0,
        flagged: 0,
        coverageNotRun: 0,
        spelling: 0,
        spellingNotRun: 0,
        changes: new Map(),
      } satisfies Week);
    weeks.set(key, w);
    w.meetings += 1;
    if (!r.coverage_json) w.coverageNotRun += 1;
    else w.flagged += Array.isArray(r.coverage_json.missed) ? r.coverage_json.missed.length : 0;
    if (!r.spelling_changes) w.spellingNotRun += 1;
    else {
      for (const c of r.spelling_changes) {
        w.spelling += c.count;
        const k = `${c.from} -> ${c.to}`;
        w.changes.set(k, (w.changes.get(k) ?? 0) + c.count);
      }
    }
  }
  return [...weeks.values()].sort((a, b) => b.week.localeCompare(a.week) || a.company_id.localeCompare(b.company_id));
}

export function reportLines(weeks: readonly Week[], names: ReadonlyMap<string, string>): string[] {
  if (weeks.length === 0) return ["  No meetings analysed in this window on this instance."];
  const n = (v: number, notRun: number) => (notRun > 0 ? `${v} (${notRun} not run)` : String(v));
  const lines = [
    `  ${"week".padEnd(12)}${"company".padEnd(28)}${"meetings".padStart(9)}` +
      `${"flagged".padStart(18)}${"spelling".padStart(18)}`,
  ];
  for (const w of weeks) {
    lines.push(
      `  ${w.week.padEnd(12)}${(names.get(w.company_id) ?? w.company_id).slice(0, 26).padEnd(28)}` +
        `${String(w.meetings).padStart(9)}${n(w.flagged, w.coverageNotRun).padStart(18)}` +
        `${n(w.spelling, w.spellingNotRun).padStart(18)}`
    );
  }
  const corrected = weeks.filter((w) => w.changes.size > 0);
  if (corrected.length > 0) {
    lines.push("", "  Spelling corrections, to read for wrong ones:");
    for (const w of corrected) {
      const list = [...w.changes].map(([k, c]) => (c > 1 ? `${k} (x${c})` : k)).join(", ");
      lines.push(`    ${w.week}  ${(names.get(w.company_id) ?? w.company_id).slice(0, 26)}: ${list}`);
    }
  }
  return lines;
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const weeksArg = args.indexOf("--weeks");
  const weeks = weeksArg === -1 ? 6 : Number(args[weeksArg + 1] ?? 6);
  const since = new Date(Date.now() - weeks * 7 * 86400_000).toISOString();

  const summary = await forEachActiveInstance<string[]>({
    job: "analysis-weekly",
    run: async ({ admin }) => {
      const { data, error } = await admin
        .from("meeting_analyses")
        .select("meeting_id, created_at, coverage_json, spelling_changes")
        .gte("created_at", since);
      // Loud rather than an empty table: a missing column is the fleet
      // out of step, and an empty report would read as a quiet week.
      if (error) throw new Error(error.message);
      const analyses = (data ?? []) as Array<Omit<AnalysisRow, "company_id"> & { meeting_id: string }>;
      const meetingIds = analyses.map((a) => a.meeting_id);
      const { data: meetings, error: mErr } = meetingIds.length
        ? await admin.from("meetings").select("id, company_id").in("id", meetingIds)
        : { data: [], error: null };
      if (mErr) throw new Error(mErr.message);
      const companyOf = new Map(
        ((meetings ?? []) as Array<{ id: string; company_id: string | null }>).map((m) => [m.id, m.company_id])
      );
      const rows: AnalysisRow[] = analyses
        .filter((a) => companyOf.get(a.meeting_id))
        .map((a) => ({ ...a, company_id: companyOf.get(a.meeting_id) as string }));
      const ids = [...new Set(rows.map((r) => r.company_id))];
      const { data: companies } = ids.length
        ? await admin.from("companies").select("id, name").in("id", ids)
        : { data: [] as Array<{ id: string; name: string }> };
      const names = new Map(
        ((companies ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name])
      );
      return reportLines(summarise(rows), names);
    },
    line: (lines) => `\n${lines.join("\n")}`,
  });

  process.exit(summary.ok ? 0 : 1);
}

if (isEntryPoint(import.meta.url)) {
  void main();
}
