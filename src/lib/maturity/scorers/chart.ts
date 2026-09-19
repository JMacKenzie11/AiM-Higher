import type { SupabaseClient } from "@supabase/supabase-js";
import { clampScore, type DisciplineScore } from "../types";

// Chart score = how populated the accountability chart is.
// Each non-archived function contributes to two ratios:
//   - has lead_id                        → 5 pts
//   - has ≥1 critical success factor     → 5 pts
// Ratios are computed as (functions passing / total non-archived).
//
// ---- THE TWO MEASURE BANDS MERGED IN 0216 -------------------
//
// They were 3 points for "has a CSF" and 2 for "has a KPI". With one
// kind those are the same test, and keeping them apart would have
// awarded a function 5 points for one row counted twice.
//
// SCORES MOVE, and upward. A function that had critical success
// factors and no KPIs was losing the 2-point band; one that had KPIs
// filed under no CSF was losing the 3. Both now score the full 5.
// That is a real change in a number people watch, not a rounding
// artefact, and it belongs in the release note rather than being
// discovered on a Monday.
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
  missing: readonly ("lead" | "measure")[];
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
        withMeasure: 0,
        issues: [],
      },
    };
  }

  const withLead = functions.filter((f) => !!f.lead_id).length;

  const fnIds = functions.map((f) => f.id);

  // Which functions have at least one measure. One query, no kind
  // filter, and no second set to keep in step with the first.
  const { data: allMeasureRows } = await admin
    .from("success_measures")
    .select("id, function_id")
    .in("function_id", fnIds)
    .eq("archived", false);
  const allMeasures = (allMeasureRows ?? []) as Array<{
    id: string;
    function_id: string | null;
  }>;
  const fnsWithMeasure = new Set(
    allMeasures
      .filter((m) => m.function_id)
      .map((m) => m.function_id as string)
  );

  const points = (withLead / total) * 5 + (fnsWithMeasure.size / total) * 5;

  const issues: ChartFunctionIssue[] = functions
    .map((f) => {
      const missing: ChartFunctionIssue["missing"][number][] = [];
      if (!f.lead_id) missing.push("lead");
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
      withMeasure: fnsWithMeasure.size,
      issues,
    },
  };
}
