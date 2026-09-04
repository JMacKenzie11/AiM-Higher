import type { SupabaseClient } from "@supabase/supabase-js";
import type { FunctionOutcome, SuccessMeasure } from "@/lib/types";

// The functional chart still talks about "outcomes". The database no
// longer has them: migration 0166 turned every outcome into a
// critical success factor stored in `success_measures`, and migration
// 0168 dropped `function_outcomes` for good.
//
// Rather than rewrite every chart component around a new shape, this
// maps a CSF row back into the `FunctionOutcome` the chart already
// renders. Two fields move:
//
//   CSF description  ->  outcome title        (the name)
//   CSF detail       ->  outcome description  (the why-this-matters)
//
// This is not the transition mirror that preceded it. Nothing is
// written twice and nothing can drift, because there is only one row.
// It is a read-side adapter over the one table, and it stays until
// the chart's own vocabulary catches up with the product's.

// The columns a CSF row needs for the mapping below. Kept as a
// constant so a query and its cast can never disagree.
export const CSF_AS_OUTCOME_COLUMNS =
  "id, function_id, description, detail, sort_order, archived, created_at, updated_at";

export type CsfRow = {
  id: string;
  function_id: string | null;
  description: string;
  detail: string | null;
  sort_order: number;
  archived: boolean;
  created_at: string;
  updated_at: string;
};

export function csfAsOutcome(row: CsfRow): FunctionOutcome {
  return {
    id: row.id,
    // A CSF's function_id is set on every row 0166 wrote and every
    // row written since. The fallback keeps the type honest rather
    // than describing a case that occurs.
    function_id: row.function_id ?? "",
    title: row.description,
    description: row.detail,
    sort_order: row.sort_order,
    archived: row.archived,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// The reverse, for writes: the chart edits a title and a description,
// which land on a CSF's description and detail.
export function outcomeFieldsToCsf(fields: {
  title?: string;
  description?: string | null;
}): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (fields.title !== undefined) patch.description = fields.title;
  if (fields.description !== undefined) patch.detail = fields.description;
  return patch;
}

// A measure carries no outcome_id since 0168. Which CSF a KPI drives
// lives in `csf_kpi_links`, which is many-to-many by design even
// though the UI allows one today. Callers that need the old
// one-parent view take the first link.
export function firstCsfIdByKpi(
  links: Array<{ csf_id: string; kpi_id: string }>
): Map<string, string> {
  const byKpi = new Map<string, string>();
  for (const link of links) {
    if (!byKpi.has(link.kpi_id)) byKpi.set(link.kpi_id, link.csf_id);
  }
  return byKpi;
}

// Group KPIs under the CSF each one drives.
export function kpisByCsf<T extends Pick<SuccessMeasure, "id">>(
  measures: T[],
  links: Array<{ csf_id: string; kpi_id: string }>
): Map<string, T[]> {
  const byCsf = new Map<string, T[]>();
  const byId = new Map(measures.map((m) => [m.id, m]));
  for (const link of links) {
    const measure = byId.get(link.kpi_id);
    if (!measure) continue;
    const arr = byCsf.get(link.csf_id) ?? [];
    arr.push(measure);
    byCsf.set(link.csf_id, arr);
  }
  return byCsf;
}

// Archiving a critical success factor archives the lead measures
// beneath it. Without this a KPI outlives the result it was there to
// move: still collecting weekly values, still nagging its owner, no
// longer attached to anything a leader looks at.
//
// One direction only. Restoring a CSF does not restore its KPIs,
// because some of them were archived on purpose beforehand and
// bringing those back would be a surprise.
export async function cascadeArchiveKpis(
  supabase: SupabaseClient,
  csfId: string
): Promise<number> {
  const { data: links } = await supabase
    .from("csf_kpi_links")
    .select("kpi_id")
    .eq("csf_id", csfId);
  const kpiIds = ((links ?? []) as Array<{ kpi_id: string }>).map(
    (l) => l.kpi_id
  );
  if (kpiIds.length === 0) return 0;

  await supabase
    .from("success_measures")
    .update({ archived: true })
    .in("id", kpiIds);
  return kpiIds.length;
}
