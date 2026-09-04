import type { SupabaseClient } from "@supabase/supabase-js";
import { clampScore, type DisciplineScore } from "../types";

// Success tracking score. Only computed when the company has the
// performance_tracking feature — otherwise the caller records a
// null score so the discipline sits as a muted "not enabled" tile.
//
//   - % of active measures with a target set    → 3 pts
//   - % of active measures with an entry in the
//     last 7 days                                → 5 pts
//   - Any measure marked auto_track that has NO
//     entry in the last 7 days is a broken commitment to weekly
//     logging — dock 0.5 pts per gap, cap at 2   → up to 2 pt penalty
// Cadence dominates by design: a target that's never logged tells us
// nothing about how the business is actually doing.

export async function scoreMeasures(
  admin: SupabaseClient,
  companyId: string
): Promise<DisciplineScore> {
  // Every measure, of either kind, hangs off a function directly.
  // Resolve the company through that and pull only active
  // (non-archived) measures for it.
  const { data: fnRows } = await admin
    .from("functions")
    .select("id")
    .eq("company_id", companyId)
    .eq("archived", false);
  const fnIds = ((fnRows ?? []) as Array<{ id: string }>).map((f) => f.id);
  if (fnIds.length === 0) {
    return {
      key: "measures",
      score: 0,
      breakdown: {
        totalMeasures: 0,
        withTarget: 0,
        withRecentEntry: 0,
        autoTrackGaps: 0,
      },
    };
  }

  // Counts BOTH kinds. Decided 2026-09-04: Success Tracking measures
  // how well a company keeps up with its numbers, and a CSF is a
  // number the company is accountable for. Leaving it out would
  // report a rosier picture than the truth.
  //
  // Consequence, accepted at the time: scores fall the day this
  // ships, because migrated CSFs arrive with no target and no
  // history. That is the score being honest about work not yet done,
  // not a regression. It recovers as leaders set targets and log.
  //
  // Migrated CSFs carry auto_track = false, so they lower the target
  // and cadence shares but never trigger the missed-logging penalty.
  const { data: measureRows } = await admin
    .from("success_measures")
    .select("id, target, auto_track")
    .in("function_id", fnIds)
    .eq("archived", false);
  const measures = (measureRows ?? []) as Array<{
    id: string;
    target: string | null;
    auto_track: boolean;
  }>;
  const total = measures.length;
  if (total === 0) {
    return {
      key: "measures",
      score: 0,
      breakdown: {
        totalMeasures: 0,
        withTarget: 0,
        withRecentEntry: 0,
        autoTrackGaps: 0,
      },
    };
  }

  const withTarget = measures.filter(
    (m) => !!m.target && m.target.trim().length > 0
  ).length;

  // Rolling 7 days — matches the weekly-log cadence.
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const measureIds = measures.map((m) => m.id);
  const { data: entryRows } = await admin
    .from("success_measure_entries")
    .select("measure_id")
    .in("measure_id", measureIds)
    .gte("week_ending", cutoff);
  const measuresWithRecent = new Set(
    ((entryRows ?? []) as Array<{ measure_id: string }>).map(
      (e) => e.measure_id
    )
  );

  const withRecentEntry = measuresWithRecent.size;
  const autoTrackGaps = measures.filter(
    (m) => m.auto_track && !measuresWithRecent.has(m.id)
  ).length;

  const targetPct = withTarget / total;
  const cadencePct = withRecentEntry / total;

  const points =
    targetPct * 3 + cadencePct * 5 - Math.min(2, autoTrackGaps * 0.5);

  return {
    key: "measures",
    score: clampScore(points),
    breakdown: {
      totalMeasures: total,
      withTarget,
      withRecentEntry,
      autoTrackGaps,
      targetPct: Math.round(targetPct * 100),
      cadencePct: Math.round(cadencePct * 100),
    },
  };
}
