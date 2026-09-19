import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { addDays, thisFriday } from "@/lib/dates";
import type {
  MetricValueType,
  TargetDirection,
  UpdateFrequency,
} from "@/lib/types";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import type { TargetHistoryRow } from "@/lib/measures/target-history";

// The rows /measures reads, fetched once.
//
// The page renders two things from the same data: the Board (13 weeks
// across every function) and the Manager (the authoring and
// value-entry tree). They were built by two loaders that each walked
// the same chain and then read entries over different windows, so
// four of five reads were the same rows fetched twice per page load.
//
// 0216 collapsed the two measure kinds into one, which took the chain
// with it. There is no link table to walk and no second read for the
// rows the first read pointed at: a function's measures are one
// select, and the tree and the board both shape that same list.
//
// So the reads live here and the shaping lives in two pure builders
// (buildMeasuresTree, buildBoardData). Neither builder touches the
// database, which is why they can be tested against fixed rows and why
// adding a third consumer costs no queries.
//
// COLUMN LISTS ARE THE TREE'S, deliberately. The board selected a
// strict subset of the same columns from the same tables, so the
// superset serves both and no projection widened: nothing here selects
// a column neither consumer reads. Kept explicit rather than "*" for
// the reason in spec §19.
//
// THE ENTRY WINDOW IS THE GRID'S. A rolling year is the widest any
// consumer wants, so one read covers all of them and each narrows in
// memory: the board takes the last 13 weeks, the tree its five-week
// trail. Fetching a narrower window would mean a second query for
// rows already in hand.
//
// It was the board's 13 weeks, then the grid's 26. Widening it costs
// one predicate on an indexed column: a company with 30 measures and
// a full year of history is 1,560 entries, which is a small read by
// any measure on this page, and most of the fleet has under 30 rows
// in total.
//
// No caching here beyond what the caller does. Nothing is memoized
// at module scope, which would be a cross-tenant leak (see the note
// in src/lib/instances/registry.ts).
//
// Loaded once per page. /measures builds the tree from it and
// /dashboard builds the board from it; they are separate pages and
// each loads its own.

export const BOARD_WEEKS = 13;

// How far back /measures scrolls: a rolling twelve months of Fridays,
// current week included.
//
// 52 rather than 26, decided once the grid existed. Six months shows
// a season; a year shows the same season last year, which is the
// comparison most of these numbers are actually read for. The window
// rolls with today rather than resetting in January, so it never has
// a thin week in the first days of a year.
//
// It is a window, not paging. Everything on file across the fleet
// today sits inside it, and the company that outgrows a year wants a
// different surface rather than a longer table.
export const GRID_WEEKS = 52;

// How far back the Manager's "recent" pills reach. Five weeks plus the
// current one, matching what the row renders.
export const TREE_TRAIL_DAYS = 35;

export type SpineFunction = {
  id: string;
  title: string;
  lead_id: string | null;
  track_id: string | null;
  sort_order: number;
  parent_function_id: string | null;
};

export type SpineCsf = {
  id: string;
  description: string;
  detail: string | null;
  target: string | null;
  value_type: MetricValueType;
  target_direction: TargetDirection;
  auto_track: boolean;
  update_frequency: UpdateFrequency;
  target_hint: string | null;
  function_id: string;
  sort_order: number;
  // Anchors the frequency rhythm: nothing is expected before the
  // measure existed. A fortnightly measure also counts from here.
  created_at: string;
  // Stored and shown on the settings panel. Nothing filters on it
  // yet; see 0218.
  show_on_dashboard: boolean;
};

export type SpineEntry = {
  measure_id: string;
  week_ending: string;
  value_number: number | null;
  value_text: string | null;
};

export type MeasuresSpine = {
  weekEnding: string;
  // 13 week-ending Fridays, oldest first. The board plots these
  // columns; the tree ignores them.
  weeks: string[];
  functions: SpineFunction[];
  roster: Array<{ id: string; full_name: string }>;
  csfRows: SpineCsf[];
  // Every target that has ever applied to these measures, not only
  // those inside the window. A week is judged against the row in
  // force when it closed, and that row is usually older than the
  // oldest week on screen: the backfill dated most of them to the
  // measure's creation. Clipping to the window would leave the
  // earliest columns reading "no target set" for measures that have
  // always had one.
  targetRows: TargetHistoryRow[];
  // The full 13-week window, week_ending descending. The tree's
  // "recent" trail is a slice of this, not a second query.
  entryRows: SpineEntry[];
};

const FUNCTION_COLS =
  "id, title, sort_order, parent_function_id, lead_id, track_id";
const CSF_COLS =
  "id, description, detail, target, value_type, target_direction, auto_track, update_frequency, target_hint, function_id, sort_order, created_at, show_on_dashboard";
const ENTRY_COLS = "measure_id, week_ending, value_number, value_text";
const TARGET_COLS =
  "measure_id, target, value_type, target_direction, effective_from";

// `count` Fridays ending at weekEnding, oldest first.
export function weeksBack(weekEnding: string, count: number): string[] {
  const weeks: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    weeks.push(addDays(weekEnding, -7 * i));
  }
  return weeks;
}

export function boardWeeks(weekEnding: string): string[] {
  return weeksBack(weekEnding, BOARD_WEEKS);
}

export async function loadMeasuresSpine(
  companyId: string,
  timezone: string
): Promise<MeasuresSpine> {
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const weekEnding = thisFriday(timezone);
  // The widest window any consumer takes. Named for the board for
  // historical reasons; it is the grid's now.
  const weeks = weeksBack(weekEnding, GRID_WEEKS);

  const empty: MeasuresSpine = {
    weekEnding,
    weeks,
    functions: [],
    roster: [],
    csfRows: [],
    targetRows: [],
    entryRows: [],
  };

  // Everyone in the company reads every function. These are the
  // company's commitments to itself, and someone who cannot see what
  // their own function is held to cannot align to it. Writing stays
  // narrow: canLog on the tree decides who gets an input.
  //
  // Ordered by sort_order because the board maps over these rows in
  // order. The tree re-sorts into hierarchy order regardless.
  const [{ data: functionRows }, { data: rosterRows }] = await Promise.all([
    supabase
      .from("functions")
      .select(FUNCTION_COLS)
      .eq("company_id", companyId)
      .eq("archived", false)
      .order("sort_order"),
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("company_id", companyId),
  ]);

  const functions = (functionRows ?? []) as SpineFunction[];
  if (functions.length === 0) return empty;

  const roster = (rosterRows ?? []) as Array<{ id: string; full_name: string }>;
  const functionIds = functions.map((f) => f.id);

  // Every live measure on these functions. There is one kind since
  // 0216, so there is no kind filter and no second read: the tree and
  // the board both walk this one list.
  const { data: csfRaw } = await supabase
    .from("success_measures")
    .select(CSF_COLS)
    .in("function_id", functionIds)
    .eq("archived", false)
    .order("sort_order");
  const csfRows = (csfRaw ?? []) as SpineCsf[];
  const csfIds = csfRows.map((c) => c.id);

  const measureIds = csfIds;

  const targetRows =
    measureIds.length === 0
      ? []
      : (((
          await supabase
            .from("success_measure_targets")
            .select(TARGET_COLS)
            .in("measure_id", measureIds)
            .order("effective_from", { ascending: false })
        ).data ?? []) as TargetHistoryRow[]);
  const entryRows =
    measureIds.length === 0
      ? []
      : (((
          await supabase
            .from("success_measure_entries")
            .select(ENTRY_COLS)
            .in("measure_id", measureIds)
            .gte("week_ending", weeks[0])
            .lte("week_ending", weekEnding)
            .order("week_ending", { ascending: false })
        ).data ?? []) as SpineEntry[]);

  return {
    weekEnding,
    weeks,
    functions,
    roster,
    csfRows,
    targetRows,
    entryRows,
  };
}

// Depth-first pre-order over the function tree, with Visionary
// pinned first and Integrator second at the top level. Anything at
// the same level that isn't Visionary or Integrator falls through
// to the standard sort_order / title ordering.
export function orderFunctionsByHierarchy<
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
