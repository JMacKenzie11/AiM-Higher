import type { FunctionOutcome } from "@/lib/types";

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
// `target` rides along since 0216. With one level, a critical
// success factor is the measurable thing, so anything rendering the
// chart's outcomes — the role description most of all — needs the
// number it is held to, and used to reach it through a KPI.
export const CSF_AS_OUTCOME_COLUMNS =
  "id, function_id, description, detail, target, sort_order, archived, created_at, updated_at";

export type CsfRow = {
  id: string;
  function_id: string | null;
  description: string;
  detail: string | null;
  target: string | null;
  sort_order: number;
  archived: boolean;
  created_at: string;
  updated_at: string;
};

export function csfAsOutcome(row: CsfRow): FunctionOutcome & { target: string | null } {
  return {
    id: row.id,
    // A CSF's function_id is set on every row 0166 wrote and every
    // row written since. The fallback keeps the type honest rather
    // than describing a case that occurs.
    function_id: row.function_id ?? "",
    title: row.description,
    description: row.detail,
    target: row.target,
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
