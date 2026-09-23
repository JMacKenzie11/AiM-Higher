import type { SupabaseClient } from "@supabase/supabase-js";
import { clampScore, type DisciplineScore } from "../types";

// Success tracking score. Computed for every company.
//
// It used to run only for a company holding performance_tracking,
// with the caller recording a null score so the discipline sat as a
// muted "not enabled" tile. That flag stopped meaning "this company
// tracks" on 2026-09-19 — it means "chase them about it" — so gating
// the score on it would have dropped this discipline off every
// scorecard on the fleet the moment it went off.
//
//   - % of active measures with a target set    → 3 pts
//   - % of active measures with an entry in the
//     last 7 days                                → 5 pts
// There was a third rule, removed 2026-09-23 with the auto_track
// column it read: a penalty of 0.5 per unlogged auto_track measure,
// capped at 2. Every measure it charged for had already lost its
// share of the 5 cadence points, so it billed the same gap twice.
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
  // THE MISSED-LOGGING PENALTY IS GONE, with the flag it read.
  //
  // It subtracted up to 2 points for measures marked auto_track with
  // no recent entry. Migration 0232 drops that column, and applying
  // the penalty to every measure instead would double-count: a
  // measure with no recent entry has ALREADY cost the company its
  // share of cadencePct, which is worth 5 points. Charging it twice
  // says nothing new and makes the score harder to reason about.
  //
  // Consequence, stated rather than discovered: a company carrying
  // gaps scores UP TO 2 POINTS HIGHER from the first recompute after
  // this ships. Nothing about the company changed; the double charge
  // stopped.
  const { data: measureRows } = await admin
    .from("success_measures")
    .select("id, target")
    .in("function_id", fnIds)
    .eq("archived", false);
  const measures = (measureRows ?? []) as Array<{
    id: string;
    target: string | null;
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

  const targetPct = withTarget / total;
  const cadencePct = withRecentEntry / total;

  const points = targetPct * 3 + cadencePct * 5;

  return {
    key: "measures",
    score: clampScore(points),
    breakdown: {
      totalMeasures: total,
      withTarget,
      withRecentEntry,
      targetPct: Math.round(targetPct * 100),
      cadencePct: Math.round(cadencePct * 100),
    },
  };
}
