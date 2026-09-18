import type { MetricValueType, TargetDirection } from "@/lib/types";

// Which target applied to a given week.
//
// `success_measures.target` answers "what is the target now". This
// answers "what was it when that week closed", which is a different
// question and the only one a chart can be honest about. Lowering a
// target in September must not turn August's misses into hits.
//
// ---- THE RULE -------------------------------------------------
//
// The row with the greatest effective_from that is not after the week
// in question. effective_from is always a Friday and week_ending is
// always a Friday, so the comparison is between like things and a
// target set this week applies to this week.
//
// ---- TWO KINDS OF NOTHING, ONE ANSWER -------------------------
//
// No row applies because the measure had no target yet, and a row
// applies whose target is null because somebody cleared it. Both mean
// the same thing to a reader: this week is not judged. So both return
// null here rather than being distinguished by a caller that would
// only have to collapse them again.
//
// The distinction is kept in the DATABASE, where it matters: without
// a row recording the clearing, the lookup would keep finding the old
// number and keep judging new weeks against a target nobody wants.
//
// ---- VALUE TYPE TRAVELS WITH THE TARGET -----------------------
//
// A target moving from '30%' to '0.30' changes its type as well as
// its text, so value_type and target_direction are carried on the
// history row and returned from here. Judging August against
// September's interpretation would be the same bug as judging it
// against September's number.
//
// For DISPLAY, keep using the measure's current value_type. How a
// number is drawn today is a presentation choice; how a week was
// judged is a fact about that week.

export type TargetHistoryRow = {
  measure_id: string;
  target: string | null;
  value_type: MetricValueType;
  target_direction: TargetDirection;
  effective_from: string;
};

export type TargetInForce = {
  target: string;
  valueType: MetricValueType;
  targetDirection: TargetDirection;
};

// Rows for ONE measure, in any order. Returns null when that week is
// not judged: either nothing applied yet, or the target was cleared.
export function targetInForce(
  rows: readonly TargetHistoryRow[],
  weekEnding: string
): TargetInForce | null {
  let best: TargetHistoryRow | null = null;
  for (const row of rows) {
    if (row.effective_from > weekEnding) continue;
    // Strictly greater, so equal dates keep the first seen. The table
    // has a unique index on (measure_id, effective_from), so equal
    // dates cannot happen for one measure and this is only defence
    // against a caller passing two measures' rows in together.
    if (best === null || row.effective_from > best.effective_from) best = row;
  }
  if (best === null) return null;
  if (best.target === null || best.target.trim() === "") return null;
  return {
    target: best.target,
    valueType: best.value_type,
    targetDirection: best.target_direction,
  };
}

// The same question asked once per measure, for a page that renders
// many. Splitting the rows up front turns an O(measures x rows) scan
// into one pass, which matters on a six-month grid.
export function groupTargetHistory(
  rows: readonly TargetHistoryRow[]
): Map<string, TargetHistoryRow[]> {
  const byMeasure = new Map<string, TargetHistoryRow[]>();
  for (const row of rows) {
    const list = byMeasure.get(row.measure_id);
    if (list) list.push(row);
    else byMeasure.set(row.measure_id, [row]);
  }
  return byMeasure;
}

// Where the target moved, within a window of weeks. The grid marks
// these so a step in a trend has a stated reason rather than looking
// like the data changed.
//
// A change is reported on the first week it APPLIES, not on the date
// it was typed: the reader is looking at weeks, and a marker between
// two weeks they cannot see explains nothing.
export function targetChangesWithin(
  rows: readonly TargetHistoryRow[],
  weeks: readonly string[]
): Map<string, { from: string | null; to: string | null }> {
  const out = new Map<string, { from: string | null; to: string | null }>();
  if (weeks.length === 0) return out;
  const sorted = [...rows].sort((a, b) =>
    a.effective_from < b.effective_from ? -1 : a.effective_from > b.effective_from ? 1 : 0
  );
  for (const [i, row] of sorted.entries()) {
    // The first row is where a target began, not where one changed.
    // A measure that has always had the same target has nothing to
    // mark, and marking its creation would put a line on every row.
    if (i === 0) continue;
    // A change that took effect at or before the first week shown is
    // already baked into that week's target. There is no boundary
    // between two visible weeks for the line to sit on, and drawing
    // it on the leftmost column reports a change the reader cannot
    // see either side of. Caught by a test; the earlier guard
    // compared the found week against weeks[0], which is always true
    // by construction and therefore excluded nothing.
    if (row.effective_from <= weeks[0]) continue;
    const week = weeks.find((w) => w >= row.effective_from);
    if (week === undefined) continue;
    out.set(week, {
      from: sorted[i - 1].target,
      to: row.target,
    });
  }
  return out;
}
