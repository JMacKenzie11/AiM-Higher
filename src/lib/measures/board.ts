import "server-only";

import {
  BOARD_WEEKS,
  loadMeasuresSpine,
  type MeasuresSpine,
} from "@/lib/measures/spine";
import type { MetricValueType, TargetDirection } from "@/lib/types";
import { formatMeasureValue, parseScale } from "./value-format";

// Read model for the operational Success Tracking board — 13
// weeks of metric performance across every function in the company.
// The board wants everything, sorted for status-first reading, and
// doesn't care about ownership.
//
// Shaping only. The rows come from loadMeasuresSpine, shared with the
// Manager tree, because four of the five reads were identical and the
// page renders both on the same paint.

export type BoardStatus = "good" | "off" | "unlogged" | "no_target";

export type BoardCell = {
  weekEnding: string;
  status: BoardStatus;
  // Pre-formatted value for the hover tooltip — the component
  // shouldn't need to re-derive from raw number/text.
  displayValue: string;
  // Numeric value for plotting. For number/percent this is the
  // raw number; for text/yes-no metrics we normalise to 1 (matches
  // target) or 0 (doesn't). Null when unlogged / no target.
  numericValue: number | null;
};

export type BoardMetric = {
  id: string;
  description: string;
  target: string | null;
  // Numeric form of the target for plotting the reference line.
  // Text metrics get a target of 1 to match the numericValue scale.
  targetNumeric: number | null;
  valueType: MetricValueType;
  direction: TargetDirection;
  cells: BoardCell[];
};

export type BoardFunction = {
  id: string;
  title: string;
  seatHolder: string | null;
  parentId: string | null;
  // 0 for a root function (typically Visionary), 1 for its
  // children (typically Integrator), 2+ for everything downstream.
  // Used to keep the leadership seats pinned at the top of the
  // cockpit view regardless of current-week performance.
  depth: number;
  metrics: BoardMetric[];
};

export type BoardData = {
  weeks: string[];
  currentWeekEnding: string;
  functions: BoardFunction[];
  // Has ANY value been recorded in the window this board covers?
  //
  // Not derivable from the cells, which is why it is carried. A cell's
  // status is `no_target` before it is anything else, so a measure
  // with a year of values and no target looks identical to one nobody
  // has ever logged. Asking the rows directly is the only honest
  // answer, and the board is the only thing that wants it.
  //
  // This is what decides whether the board appears at all: a frame of
  // empty weeks teaches nobody anything, while one real point is
  // sparse and true.
  hasEntries: boolean;
};

// The Board, shaped from rows already in hand. Pure: see
// loadMeasuresSpine for the reads and getBoardData below, which is
// the path /dashboard takes.
export function buildBoardData(spine: MeasuresSpine): BoardData {
  // THE BOARD NARROWS. The spine fetches the grid's six months now,
  // because it is the widest window any consumer takes and one read
  // serves them all. The board is still 13 weeks: it is a glance, and
  // a sparkline with 26 points in the width of a card is a smudge.
  const { weekEnding: currentWeekEnding } = spine;
  const weeks = spine.weeks.slice(-BOARD_WEEKS);

  // COUNTED OVER THE MEASURES THAT WILL RENDER, not over every entry
  // the company has. A company whose logged measures are all hidden
  // from the dashboard would otherwise pass this and draw a board of
  // empty frames — the exact "thirteen columns of blank" this field
  // exists to prevent, arrived at from the other direction.
  const shownIds = new Set(
    spine.csfRows.filter((c) => c.show_on_dashboard).map((c) => c.id)
  );
  const hasEntries = spine.entryRows.some((e) => shownIds.has(e.measure_id));

  const functions = spine.functions;
  if (functions.length === 0) {
    return { weeks, currentWeekEnding, functions: [], hasEntries };
  }
  const rosterById = new Map(spine.roster.map((r) => [r.id, r.full_name]));

  // CSF measures supply the grouping label each metric row shows
  // (migration 0166). A CSF's `description` is what the outcome
  // called `title`.
  // One kind since 0216, so a row is a row. This used to build two
  // lists and stitch them through csf_kpi_links so a KPI could show
  // the CSF it belonged to; there is no belonging any more.
  // ONLY WHAT SOMEBODY CHOSE TO PUT HERE.
  //
  // show_on_dashboard has been written by the measure form since
  // 0218 and read by nothing, which made it a checkbox that did
  // nothing — worse than an absent control, because it looked like a
  // decision. This is the decision it makes.
  //
  // The GRID still shows every measure. The board is the glance, and
  // a company with thirty measures had thirty sparklines on the page
  // people open first; the flag is how a company says which of them
  // are the ones to look at.
  const measures = spine.csfRows
    .filter((c) => c.show_on_dashboard)
    .map((c) => ({
    id: c.id,
    description: c.description,
    target: c.target,
    value_type: c.value_type,
    value_scale: c.value_scale,
    target_direction: c.target_direction,
    sort_order: c.sort_order,
    function_id: c.function_id,
  }));

  const entriesByMeasureWeek = new Map<
    string,
    { number: number | null; text: string | null }
  >();
  for (const row of spine.entryRows) {
    entriesByMeasureWeek.set(`${row.measure_id}|${row.week_ending}`, {
      number: row.value_number,
      text: row.value_text,
    });
  }

  // Depth = number of hops to reach a root ancestor. Used by the
  // cockpit view so Visionary (root) and Integrator (Visionary's
  // child) always sit at the top of the grid regardless of how
  // this week's numbers landed.
  const parentById = new Map(
    functions.map((f) => [f.id, f.parent_function_id])
  );
  const depthCache = new Map<string, number>();
  const computeDepth = (id: string, seen = new Set<string>()): number => {
    if (depthCache.has(id)) return depthCache.get(id)!;
    if (seen.has(id)) return 0; // cycle guard
    seen.add(id);
    const parent = parentById.get(id);
    const d = parent ? 1 + computeDepth(parent, seen) : 0;
    depthCache.set(id, d);
    return d;
  };

  const boardFunctions: BoardFunction[] = functions.map((fn) => {
    // Straight down the function's list. 0216 renumbered sort_order
    // so a measure still sits where its company left it, which is why
    // this needs no grouping pass of its own.
    const fnMeasures = measures
      .filter((m) => m.function_id === fn.id)
      .sort((a, b) => a.sort_order - b.sort_order);
    return {
      id: fn.id,
      title: fn.title,
      seatHolder: fn.lead_id ? rosterById.get(fn.lead_id) ?? null : null,
      parentId: fn.parent_function_id,
      depth: computeDepth(fn.id),
      metrics: fnMeasures.map((m) => {
        const targetNumeric =
          m.value_type === "text"
            ? m.target
              ? 1
              : null
            : parseNum(m.target);
        return {
          id: m.id,
          description: m.description,
          target: m.target,
          targetNumeric,
          valueType: m.value_type,
          direction: m.target_direction,
          cells: weeks.map((w) => {
            const entry = entriesByMeasureWeek.get(`${m.id}|${w}`) ?? null;
            const status = computeStatus(m, entry);
            return {
              weekEnding: w,
              status,
              displayValue: formatMeasureValue(
                m.value_type,
                parseScale(m.value_scale),
                entry,
                "—"
              ),
              numericValue: extractNumericValue(m, entry),
            };
          }),
        };
      }),
    };
  });

  return { weeks, currentWeekEnding, functions: boardFunctions, hasEntries };
}

// Load the spine and shape the board from it. This is what
// /dashboard calls.
//
// It used to be a convenience wrapper nothing in the product took,
// because /measures loaded the tree and the board together. The board
// moved, so each page loads its own spine and this is the ordinary
// path rather than the road not taken.
export async function getBoardData(
  companyId: string,
  timezone: string
): Promise<BoardData> {
  const spine = await loadMeasuresSpine(companyId, timezone);
  return buildBoardData(spine);
}

// Coerce an entry into a plottable number. For number/percent we
// return the raw value; for text (yes/no) we return 1 when the entry
// matches the target and 0 otherwise. Null when there's no entry —
// the sparkline breaks its line at null points so a missed week
// reads as a gap, not an interpolation.
function extractNumericValue(
  measure: {
    value_type: MetricValueType;
    target: string | null;
  },
  entry: { number: number | null; text: string | null } | null
): number | null {
  if (!entry) return null;
  if (measure.value_type === "text") {
    if (!entry.text) return null;
    const l = entry.text.trim().toLowerCase();
    const t = (measure.target ?? "").trim().toLowerCase();
    if (!t) return null;
    return l === t ? 1 : 0;
  }
  return entry.number != null && Number.isFinite(entry.number)
    ? entry.number
    : null;
}

// Compare an entry to its metric's target and return a bucketed
// status. Kept beside the fetch so the client component receives
// pre-shaped data and doesn't need to re-run the same comparison
// in JS on every render.
export function computeStatus(
  measure: {
    target: string | null;
    valueType?: MetricValueType;
    value_type?: MetricValueType;
    target_direction?: TargetDirection;
    direction?: TargetDirection;
  },
  entry: { number: number | null; text: string | null } | null
): BoardStatus {
  const valueType = measure.valueType ?? measure.value_type!;
  const direction = measure.direction ?? measure.target_direction!;
  if (!measure.target) return "no_target";
  if (!entry) return "unlogged";
  if (valueType === "text") {
    const l = (entry.text ?? "").trim().toLowerCase();
    const t = (measure.target ?? "").trim().toLowerCase();
    if (!l) return "unlogged";
    return l === t ? "good" : "off";
  }
  if (entry.number == null || !Number.isFinite(entry.number)) return "unlogged";
  const target = parseNum(measure.target);
  if (target == null) return "no_target";
  const hit =
    direction === "lower_is_better"
      ? entry.number <= target
      : entry.number >= target;
  return hit ? "good" : "off";
}

function parseNum(target: string | null): number | null {
  if (!target) return null;
  const cleaned = target.replace(/[^0-9.\-]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// Formatting lives in value-format.ts. The board and the grid
// showing the same number differently is the kind of thing nobody
// reports and everybody notices.
