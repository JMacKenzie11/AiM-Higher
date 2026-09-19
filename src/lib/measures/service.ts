import "server-only";

import { addDays } from "@/lib/dates";
import {
  TREE_TRAIL_DAYS,
  loadMeasuresSpine,
  type MeasuresSpine,
} from "@/lib/measures/spine";
import type {
  UpdateFrequency, MetricValueType, TargetDirection } from "@/lib/types";

// The read behind /measures.
//
// Functions, each with its critical success factors and their recent
// entries. One surface for both authoring the structure and logging
// the week.
//
// FLAT SINCE 0216. This was functions → CSFs → KPIs, and the nesting
// was the model's, not the client's: the spreadsheet every company
// actually keeps has one row per measure. Collapsing the two kinds
// took the middle level out, and with it the link walking that made
// this function most of its length.
//
// Everyone in the company reads every function. Writing is per
// function: `canLog` on each one mirrors what
// upsertMeasureEntryAction enforces, so the page never draws an input
// the server would refuse. `includeAll` no longer decides what is
// loaded, only whose functions sort first.
//
// The dashboard's "Pending this week" card and its getMeasuresOwnedBy
// loader were removed on 2026-09-04. They duplicated this page, and
// duplicated it wrongly: the card listed KPIs only, so someone who
// filled it in still had every critical success factor outstanding
// with nothing saying so.

// One critical success factor: a target, a value type, a direction,
// this week's value and the recent trail.
//
// `target` stays nullable on purpose. Decided 2026-09-04: a company
// may name its CSFs and come back to set targets later, so a CSF
// without one is a normal state, not a failure. Anything reading
// this must render it as "no target set", never as off target. The
// flat page makes those rows easy to find, which is how a company
// prunes a list it has outgrown.
export type MeasureTreeCsf = {
  id: string;
  title: string;
  description: string | null;
  target: string | null;
  value_type: MetricValueType;
  target_direction: TargetDirection;
  auto_track: boolean;
  update_frequency: UpdateFrequency;
  target_hint: string | null;
  currentValue: { number: number | null; text: string | null } | null;
  recent: Array<{
    weekEnding: string;
    number: number | null;
    text: string | null;
  }>;
};

// What the row component renders. A CSF keeps its name in `title`
// for the chart's sake, and the row reads `description`, so callers
// map it at the boundary and the row stays one shape.
export type MeasureRow = MeasureTreeCsf & { description: string };

export type MeasureTreeFunction = {
  id: string;
  title: string;
  // Whether this caller can write values against this function.
  // Per function, not per user: a leader reads the whole company and
  // types only into their own seats, and an admin or guide types
  // everywhere. Mirrors upsertMeasureEntryAction exactly, which is
  // the rule the server will actually enforce.
  canLog: boolean;
  csfs: MeasureTreeCsf[];
};

// The /measures Manager tree, shaped from rows already in hand.
//
// Pure: every read this used to do lives in loadMeasuresSpine, which
// the board shares. See getMeasuresTree below, which is the path
// /measures takes.
export function buildMeasuresTree(
  spine: MeasuresSpine,
  userId: string,
  includeAll: boolean
): { functions: MeasureTreeFunction[]; weekEnding: string } {
  const { weekEnding } = spine;
  const functions = spine.functions;
  if (functions.length === 0) return { functions: [], weekEnding };
  // Everyone gets the whole company now, so the hierarchy can always
  // be reconstructed: Visionary at the top, Integrator second, every
  // other function following its parent. The alphabetical fallback
  // existed because a partial tree cannot be walked meaningfully;
  // there are no partial trees any more.
  //
  // `includeAll` no longer decides what is loaded. It decides whose
  // functions come first, so a leader opening the page still lands on
  // their own seats rather than scrolling past everyone else's.
  const ordered = orderFunctionsByHierarchy(functions);
  const orderedFunctions = includeAll
    ? ordered
    : [
        ...ordered.filter(
          (f) => f.lead_id === userId || f.track_id === userId
        ),
        ...ordered.filter(
          (f) => f.lead_id !== userId && f.track_id !== userId
        ),
      ];

  // The name mapping is the one leftover from the outcome era: a
  // measure's `description` holds what the UI calls the title, and
  // `detail` holds the longer text under it.
  const csfs = spine.csfRows.map((c) => ({
    id: c.id,
    title: c.description,
    description: c.detail,
    target: c.target,
    value_type: c.value_type,
    target_direction: c.target_direction,
    auto_track: c.auto_track,
    update_frequency: c.update_frequency ?? "weekly",
    target_hint: c.target_hint,
    function_id: c.function_id,
    sort_order: c.sort_order,
  }));
  // The spine fetches the board's 13-week window, which is the wider
  // of the two. The Manager's trail is five weeks, so it narrows here
  // rather than issuing a second read for a subset of rows already in
  // memory.
  const oldest = addDays(weekEnding, -TREE_TRAIL_DAYS);
  const entryRows = spine.entryRows.filter(
    (row) => row.week_ending >= oldest && row.week_ending <= weekEnding
  );

  const entriesByMeasure = new Map<
    string,
    Array<{
      weekEnding: string;
      number: number | null;
      text: string | null;
    }>
  >();
  for (const row of entryRows) {
    const list = entriesByMeasure.get(row.measure_id) ?? [];
    list.push({
      weekEnding: row.week_ending,
      number: row.value_number,
      text: row.value_text,
    });
    entriesByMeasure.set(row.measure_id, list);
  }

  const csfsByFunction = new Map<string, MeasureTreeCsf[]>();
  csfs.sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.title.localeCompare(b.title);
  });
  for (const c of csfs) {
    const recent = entriesByMeasure.get(c.id) ?? [];
    const current = recent.find((r) => r.weekEnding === weekEnding) ?? null;
    const shaped: MeasureTreeCsf = {
      id: c.id,
      title: c.title,
      description: c.description,
      target: c.target,
      value_type: c.value_type,
      target_direction: c.target_direction,
      auto_track: c.auto_track,
      update_frequency: c.update_frequency,
      target_hint: c.target_hint,
      currentValue: current ? { number: current.number, text: current.text } : null,
      recent,
    };
    const list = csfsByFunction.get(c.function_id) ?? [];
    list.push(shaped);
    csfsByFunction.set(c.function_id, list);
  }

  const tree: MeasureTreeFunction[] = orderedFunctions.map((f) => ({
    id: f.id,
    title: f.title,
    // Same rule upsertMeasureEntryAction enforces. Computed here so
    // the page never renders an input the server would refuse.
    canLog: includeAll || f.lead_id === userId || f.track_id === userId,
    csfs: csfsByFunction.get(f.id) ?? [],
  }));

  return { functions: tree, weekEnding };
}

// Load the spine and shape the tree from it. This is what /measures
// calls.
//
// It used to be a convenience wrapper nothing in the product took,
// because the page loaded the tree and the board together. The board
// moved to /dashboard, so each page loads its own spine and this is
// the ordinary path rather than the road not taken.
export async function getMeasuresTree(
  companyId: string,
  userId: string,
  timezone: string,
  includeAll: boolean
): Promise<{ functions: MeasureTreeFunction[]; weekEnding: string }> {
  const spine = await loadMeasuresSpine(companyId, timezone);
  return buildMeasuresTree(spine, userId, includeAll);
}

// Depth-first pre-order over the function tree, with Visionary
// pinned first and Integrator second at the top level. Anything at
// the same level that isn't Visionary or Integrator falls through
// to the standard sort_order / title ordering.
function orderFunctionsByHierarchy<
  T extends {
    id: string;
    title: string;
    sort_order: number;
    parent_function_id: string | null;
  },
>(fns: T[]): T[] {
  const childrenByParent = new Map<string | null, T[]>();
  for (const fn of fns) {
    const key = fn.parent_function_id;
    const list = childrenByParent.get(key) ?? [];
    list.push(fn);
    childrenByParent.set(key, list);
  }

  function priorityAtTop(title: string): number {
    const t = title.trim().toLowerCase();
    if (t === "visionary") return 0;
    if (t === "integrator") return 1;
    return 2;
  }

  function sortSiblings(list: T[], atTop: boolean): T[] {
    return [...list].sort((a, b) => {
      if (atTop) {
        const pa = priorityAtTop(a.title);
        const pb = priorityAtTop(b.title);
        if (pa !== pb) return pa - pb;
      }
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return a.title.localeCompare(b.title);
    });
  }

  const result: T[] = [];
  const seen = new Set<string>();
  function walk(parentId: string | null, atTop: boolean) {
    const siblings = sortSiblings(
      childrenByParent.get(parentId) ?? [],
      atTop
    );
    for (const sib of siblings) {
      if (seen.has(sib.id)) continue;
      result.push(sib);
      seen.add(sib.id);
      walk(sib.id, false);
    }
  }
  walk(null, true);

  // Include orphans whose parent isn't in the working set (shouldn't
  // happen in practice, but keep the surface honest so a broken
  // parent pointer never silently drops a function).
  for (const fn of fns) {
    if (!seen.has(fn.id)) {
      result.push(fn);
      seen.add(fn.id);
    }
  }

  return result;
}
