import type { SupabaseClient } from "@supabase/supabase-js";
import { clampScore, type DisciplineScore } from "../types";

// Chart score = how populated the accountability chart is.
// Each non-archived function contributes to three ratios:
//   - has lead_id                  → 5 pts
//   - has ≥1 outcome               → 3 pts
//   - has ≥1 measure (via outcome) → 2 pts
// Ratios are computed as (functions passing / total non-archived).
//
// Track / Decide (the T and D of LTD) used to be scored separately
// against their own columns, but in practice there's no UI to assign
// a different person to those roles — the seat holder always covers
// LTD. Their weight collapses into Lead so the score reads what a
// user can actually act on.
//
// Attendance is deliberately NOT scored — transcript speaker-to-
// profile matching isn't reliable enough for a rating.
//
// The breakdown also carries a per-function `issues` list so the UI
// can show WHICH functions are dragging the score, not just the
// aggregate. Complete functions are omitted from the list.

type FnRow = {
  id: string;
  title: string;
  lead_id: string | null;
};

export type ChartFunctionIssue = {
  id: string;
  name: string;
  missing: readonly ("lead" | "outcome" | "measure")[];
};

export async function scoreChart(
  admin: SupabaseClient,
  companyId: string
): Promise<DisciplineScore> {
  const { data: fnRows } = await admin
    .from("functions")
    .select("id, title, lead_id")
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
        withOutcome: 0,
        withMeasure: 0,
        issues: [],
      },
    };
  }

  const withLead = functions.filter((f) => !!f.lead_id).length;

  const fnIds = functions.map((f) => f.id);

  // Which functions have at least one CSF + at least one KPI?
  // Both come from success_measures now (migration 0166), split by
  // kind, so this is one query where it used to be two plus a join
  // through function_outcomes.
  const { data: allMeasureRows } = await admin
    .from("success_measures")
    .select("id, function_id, kind")
    .in("function_id", fnIds);
  const allMeasures = (allMeasureRows ?? []) as Array<{
    id: string;
    function_id: string | null;
    kind: "csf" | "kpi";
  }>;
  const fnsWithOutcome = new Set(
    allMeasures
      .filter((m) => m.kind === "csf" && m.function_id)
      .map((m) => m.function_id as string)
  );

  let fnsWithMeasure = new Set<string>();
  {
    // function_id is on the row now, so no lookup map is needed.
    fnsWithMeasure = new Set(
      allMeasures
        .filter((m) => m.kind === "kpi" && m.function_id)
        .map((m) => m.function_id as string)
    );
  }

  const points =
    (withLead / total) * 5 +
    (fnsWithOutcome.size / total) * 3 +
    (fnsWithMeasure.size / total) * 2;

  const issues: ChartFunctionIssue[] = functions
    .map((f) => {
      const missing: ChartFunctionIssue["missing"][number][] = [];
      if (!f.lead_id) missing.push("lead");
      if (!fnsWithOutcome.has(f.id)) missing.push("outcome");
      if (!fnsWithMeasure.has(f.id)) missing.push("measure");
      return { id: f.id, name: f.title, missing };
    })
    .filter((row) => row.missing.length > 0);

  return {
    key: "chart",
    score: clampScore(points),
    breakdown: {
      totalFunctions: total,
      withLead,
      withOutcome: fnsWithOutcome.size,
      withMeasure: fnsWithMeasure.size,
      issues,
    },
  };
}
