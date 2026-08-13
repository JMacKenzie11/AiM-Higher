import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { companyHasFeature } from "@/lib/subscriptions/service";
import { todayInTimezone } from "@/lib/dates";
import { DISCIPLINES, type DisciplineKey } from "./disciplines";
import type { DisciplineScore } from "./types";
import { scoreFoundation } from "./scorers/foundation";
import { scoreChart } from "./scorers/chart";
import { scorePlanning } from "./scorers/planning";
import { scoreExecution } from "./scorers/execution";
import { scoreMeasures } from "./scorers/measures";
import { scoreMeetings } from "./scorers/meetings";
import { scoreSolutionSeeking } from "./scorers/solution-seeking";
import { scorePositiveFraming } from "./scorers/positive-framing";

// Orchestrates every scorer for a company and returns the current
// snapshot. Feature-gated disciplines whose feature is OFF get a
// null score so they're excluded from the overall average — a
// company without Success Tracking isn't dinged for not having it.
//
// Pure read side: this function NEVER writes. Callers who want to
// persist a snapshot use writeScorecardSnapshot() below.

export type ComputedScorecard = {
  companyId: string;
  computedAt: string; // ISO
  disciplines: DisciplineScore[];
  overall: {
    score: number | null;
    disciplinesCounted: number;
  };
};

export async function computeCompanyScorecard(
  companyId: string,
  admin?: SupabaseClient
): Promise<ComputedScorecard> {
  const db = admin ?? createSupabaseAdminClient();

  // Fan out the six scorers in parallel — each is a small read.
  const [foundation, chart, planning, execution, measuresEnabled, meetingsEnabled] =
    await Promise.all([
      scoreFoundation(db, companyId),
      scoreChart(db, companyId),
      scorePlanning(db, companyId),
      scoreExecution(db, companyId),
      companyHasFeature(companyId, "performance_tracking"),
      companyHasFeature(companyId, "meeting_facilitation_review"),
    ]);

  const measures: DisciplineScore = measuresEnabled
    ? await scoreMeasures(db, companyId)
    : { key: "measures", score: null, breakdown: { notEnabled: true } };
  const [meetings, solutionSeeking, positiveFraming]: DisciplineScore[] =
    meetingsEnabled
      ? await Promise.all([
          scoreMeetings(db, companyId),
          scoreSolutionSeeking(db, companyId),
          scorePositiveFraming(db, companyId),
        ])
      : [
          { key: "meetings", score: null, breakdown: { notEnabled: true } },
          {
            key: "solution_seeking",
            score: null,
            breakdown: { notEnabled: true },
          },
          {
            key: "positive_framing",
            score: null,
            breakdown: { notEnabled: true },
          },
        ];

  const all: DisciplineScore[] = [
    foundation,
    chart,
    planning,
    execution,
    measures,
    meetings,
    solutionSeeking,
    positiveFraming,
  ];

  return {
    companyId,
    computedAt: new Date().toISOString(),
    disciplines: all,
    overall: overallFrom(all),
  };
}

// Weighted average across scored disciplines. Null-score disciplines
// (feature off) are dropped, not zero — the weight is redistributed
// across the remaining ones automatically because the divisor is the
// sum of weights ACTUALLY COUNTED.
export function overallFrom(scores: DisciplineScore[]): {
  score: number | null;
  disciplinesCounted: number;
} {
  const weightByKey = new Map<DisciplineKey, number>(
    DISCIPLINES.map((d) => [d.key, d.weight])
  );

  let weighted = 0;
  let totalWeight = 0;
  let counted = 0;
  for (const s of scores) {
    if (s.score === null) continue;
    const w = weightByKey.get(s.key) ?? 1;
    weighted += s.score * w;
    totalWeight += w;
    counted += 1;
  }
  if (totalWeight === 0) return { score: null, disciplinesCounted: 0 };
  const avg = weighted / totalWeight;
  return {
    score: Math.round(avg * 10) / 10,
    disciplinesCounted: counted,
  };
}

// Persist one row per discipline for today, keyed on
// (company_id, snapshot_date, discipline). Idempotent — the unique
// constraint + upsert means a mid-day re-run overwrites cleanly.
// Snapshot date is anchored to the company's local timezone so a
// cron running at 05:00 UTC doesn't write "yesterday" for Anchorage.
export async function writeScorecardSnapshot(
  companyId: string,
  scorecard: ComputedScorecard,
  admin?: SupabaseClient
): Promise<{ ok: true; date: string } | { ok: false; message: string }> {
  const db = admin ?? createSupabaseAdminClient();

  const { data: company } = await db
    .from("companies")
    .select("timezone")
    .eq("id", companyId)
    .maybeSingle<{ timezone: string | null }>();
  const tz = company?.timezone ?? "America/Anchorage";
  const { iso: snapshotDate } = todayInTimezone(tz);

  const rows = scorecard.disciplines.map((d) => ({
    company_id: companyId,
    snapshot_date: snapshotDate,
    discipline: d.key,
    score: d.score,
    breakdown_json: d.breakdown,
  }));

  const { error } = await db
    .from("company_discipline_snapshots")
    .upsert(rows, { onConflict: "company_id,snapshot_date,discipline" });
  if (error) {
    return { ok: false, message: error.message };
  }
  return { ok: true, date: snapshotDate };
}
