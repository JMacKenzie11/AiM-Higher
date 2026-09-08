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
// the same chain — functions, critical success factors, csf_kpi_links,
// the linked KPIs — and then read entries over different windows. Four
// of five reads were the same rows fetched twice per page load, and
// each chain was five round trips deep because every step needs the
// previous step's ids.
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
// No caching here beyond what the caller does. getMeasuresPageData
// loads the spine once per render and hands the same object to both
// builders; nothing is memoized at module scope, which would be a
// cross-tenant leak (see the note in src/lib/instances/registry.ts).

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

export type SpineKpi = {
  id: string;
  description: string;
  target: string | null;
  value_type: MetricValueType;
  target_direction: TargetDirection;
  auto_track: boolean;
  update_frequency: UpdateFrequency;
  target_hint: string | null;
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
  linkRows: Array<{ csf_id: string; kpi_id: string }>;
  kpiRows: SpineKpi[];
  // The full 13-week window, week_ending descending. The tree's
  // "recent" trail is a slice of this, not a second query.
  entryRows: SpineEntry[];
};

const FUNCTION_COLS =
  "id, title, sort_order, parent_function_id, lead_id, track_id";
const CSF_COLS =
  "id, description, detail, target, value_type, target_direction, auto_track, update_frequency, target_hint, function_id, sort_order";
const KPI_COLS =
  "id, description, target, value_type, target_direction, auto_track, update_frequency, target_hint, sort_order";
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
    linkRows: [],
    kpiRows: [],
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

  // CSF measures ARE the outcomes (migration 0166). Same rows, reached
  // by function + kind. The name mapping matters: a CSF's
  // `description` holds what the outcome called `title`, and `detail`
  // holds what it called `description`.
  const { data: csfRaw } = await supabase
    .from("success_measures")
    .select(CSF_COLS)
    .in("function_id", functionIds)
    .eq("kind", "csf")
    .eq("archived", false)
    .order("sort_order");
  const csfRows = (csfRaw ?? []) as SpineCsf[];
  const csfIds = csfRows.map((c) => c.id);

  // Which KPIs hang off those CSFs. Read as a list per CSF: the
  // authoring UI allows one CSF per KPI today, but the link table is
  // many-to-many by design and a row driving two must not crash.
  const linkRows =
    csfIds.length === 0
      ? []
      : (((
          await supabase
            .from("csf_kpi_links")
            .select("csf_id, kpi_id")
            .in("csf_id", csfIds)
        ).data ?? []) as Array<{ csf_id: string; kpi_id: string }>);

  const kpiIds = Array.from(new Set(linkRows.map((l) => l.kpi_id)));
  const kpiRows =
    kpiIds.length === 0
      ? []
      : (((
          await supabase
            .from("success_measures")
            .select(KPI_COLS)
            .in("id", kpiIds)
            .eq("archived", false)
            .order("sort_order")
        ).data ?? []) as SpineKpi[]);

  // CSF ids ride along: a CSF is measured now, so it has its own
  // weekly entries and its own trail, exactly like a KPI.
  const measureIds = [...csfIds, ...kpiRows.map((m) => m.id)];
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
    linkRows,
    kpiRows,
    entryRows,
  };
}
