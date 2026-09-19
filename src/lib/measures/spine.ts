import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { addDays, thisFriday } from "@/lib/dates";
import type {
  MetricValueType,
  TargetDirection,
  UpdateFrequency,
} from "@/lib/types";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

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
// THE ENTRY WINDOW IS THE BOARD'S. 13 weeks is the wider of the two,
// so one read covers both and buildMeasuresTree narrows to its own
// five-week trail in memory. Fetching the narrower window would have
// meant two reads again.
//
// No caching here beyond what the caller does. Nothing is memoized
// at module scope, which would be a cross-tenant leak (see the note
// in src/lib/instances/registry.ts).
//
// Loaded once per page. /measures builds the tree from it and
// /dashboard builds the board from it; they are separate pages and
// each loads its own.

export const BOARD_WEEKS = 13;

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
  // The full 13-week window, week_ending descending. The tree's
  // "recent" trail is a slice of this, not a second query.
  entryRows: SpineEntry[];
};

const FUNCTION_COLS =
  "id, title, sort_order, parent_function_id, lead_id, track_id";
const CSF_COLS =
  "id, description, detail, target, value_type, target_direction, auto_track, update_frequency, target_hint, function_id, sort_order";
const ENTRY_COLS = "measure_id, week_ending, value_number, value_text";

export function boardWeeks(weekEnding: string): string[] {
  const weeks: string[] = [];
  for (let i = BOARD_WEEKS - 1; i >= 0; i -= 1) {
    weeks.push(addDays(weekEnding, -7 * i));
  }
  return weeks;
}

export async function loadMeasuresSpine(
  companyId: string,
  timezone: string
): Promise<MeasuresSpine> {
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const weekEnding = thisFriday(timezone);
  const weeks = boardWeeks(weekEnding);

  const empty: MeasuresSpine = {
    weekEnding,
    weeks,
    functions: [],
    roster: [],
    csfRows: [],
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
    entryRows,
  };
}
