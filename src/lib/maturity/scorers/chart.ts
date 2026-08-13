import type { SupabaseClient } from "@supabase/supabase-js";
import { clampScore, type DisciplineScore } from "../types";

// Chart score = how populated the accountability chart is.
// Each non-archived function contributes to four ratios:
//   - has lead_id                → 3 pts
//   - has track_id               → 2 pts
//   - has ≥1 outcome             → 3 pts
//   - has ≥1 measure (via outcome) → 2 pts
// Ratios are computed as (functions passing / total non-archived).
// Attendance is deliberately NOT scored — the transcript speaker-to-
// profile matching isn't reliable enough for a rating.
//
// The breakdown also carries a per-function `issues` list so the UI
// can show WHICH functions are dragging the score, not just the
// aggregate. Complete functions are omitted from the list so the UI
// only surfaces things a user could act on.

type FnRow = {
  id: string;
  name: string;
  lead_id: string | null;
  track_id: string | null;
};

export type ChartFunctionIssue = {
  id: string;
  name: string;
  missing: readonly ("lead" | "track" | "outcome" | "measure")[];
};

export async function scoreChart(
  admin: SupabaseClient,
  companyId: string
): Promise<DisciplineScore> {
  const { data: fnRows } = await admin
    .from("functions")
    .select("id, name, lead_id, track_id")
    .eq("company_id", companyId)
    .eq("archived", false);

  const functions = (fnRows ?? []) as FnRow[];
  const total = functions.length;

  if (total === 0) {
    return {
      key: "chart",
      score: 0,
      breakdown: {
        totalFunctions: 0,
        withLead: 0,
        withTrack: 0,
        withOutcome: 0,
        withMeasure: 0,
        issues: [],
      },
    };
  }

  const withLead = functions.filter((f) => !!f.lead_id).length;
  const withTrack = functions.filter((f) => !!f.track_id).length;

  const fnIds = functions.map((f) => f.id);

  // Which functions have at least one outcome + at least one measure?
  const { data: outcomeRows } = await admin
    .from("function_outcomes")
    .select("id, function_id")
    .in("function_id", fnIds);
  const outcomes = (outcomeRows ?? []) as Array<{
    id: string;
    function_id: string;
  }>;
  const fnsWithOutcome = new Set(outcomes.map((o) => o.function_id));

  const outcomeIds = outcomes.map((o) => o.id);
  let fnsWithMeasure = new Set<string>();
  if (outcomeIds.length > 0) {
    const { data: measureRows } = await admin
      .from("success_measures")
      .select("outcome_id")
      .in("outcome_id", outcomeIds);
    const measures = (measureRows ?? []) as Array<{ outcome_id: string }>;
    const outcomeIdToFn = new Map(outcomes.map((o) => [o.id, o.function_id]));
    fnsWithMeasure = new Set(
      measures
        .map((m) => outcomeIdToFn.get(m.outcome_id))
        .filter((fnId): fnId is string => !!fnId)
    );
  }

  const points =
    (withLead / total) * 3 +
    (withTrack / total) * 2 +
    (fnsWithOutcome.size / total) * 3 +
    (fnsWithMeasure.size / total) * 2;

  const issues: ChartFunctionIssue[] = functions
    .map((f) => {
      const missing: ChartFunctionIssue["missing"][number][] = [];
      if (!f.lead_id) missing.push("lead");
      if (!f.track_id) missing.push("track");
      if (!fnsWithOutcome.has(f.id)) missing.push("outcome");
      if (!fnsWithMeasure.has(f.id)) missing.push("measure");
      return { id: f.id, name: f.name, missing };
    })
    .filter((row) => row.missing.length > 0);

  return {
    key: "chart",
    score: clampScore(points),
    breakdown: {
      totalFunctions: total,
      withLead,
      withTrack,
      withOutcome: fnsWithOutcome.size,
      withMeasure: fnsWithMeasure.size,
      issues,
    },
  };
}
