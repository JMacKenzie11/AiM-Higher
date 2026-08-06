import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { addDays, thisFriday } from "@/lib/dates";
import type { MetricValueType, TargetDirection } from "@/lib/types";

// Read model for the operational Success Tracking board — 13
// weeks of metric performance across every function in the company.
// Deliberately separate from getMeasuresOwnedBy (which powers the
// batch entry surface) because the board wants everything, sorted
// for status-first reading, and doesn't care about ownership.

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
  outcomeTitle: string;
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
};

const WEEKS = 13;

export async function getBoardData(
  companyId: string,
  timezone: string
): Promise<BoardData> {
  const supabase = await createSupabaseServerClient();
  const currentWeekEnding = thisFriday(timezone);
  const weeks: string[] = [];
  for (let i = WEEKS - 1; i >= 0; i--) {
    weeks.push(addDays(currentWeekEnding, -7 * i));
  }
  const oldestWeek = weeks[0];

  const [{ data: functionsRaw }, { data: rosterRaw }] = await Promise.all([
    supabase
      .from("functions")
      .select("id, title, lead_id, parent_function_id, sort_order")
      .eq("company_id", companyId)
      .eq("archived", false)
      .order("sort_order"),
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("company_id", companyId),
  ]);
  const functions = (functionsRaw ?? []) as Array<{
    id: string;
    title: string;
    lead_id: string | null;
    parent_function_id: string | null;
    sort_order: number;
  }>;
  if (functions.length === 0) {
    return { weeks, currentWeekEnding, functions: [] };
  }
  const roster = (rosterRaw ?? []) as Array<{ id: string; full_name: string }>;
  const rosterById = new Map(roster.map((r) => [r.id, r.full_name]));

  const functionIds = functions.map((f) => f.id);
  const { data: outcomesRaw } = await supabase
    .from("function_outcomes")
    .select("id, title, function_id")
    .in("function_id", functionIds)
    .eq("archived", false)
    .order("sort_order");
  const outcomes = (outcomesRaw ?? []) as Array<{
    id: string;
    title: string;
    function_id: string;
  }>;
  const outcomeById = new Map(outcomes.map((o) => [o.id, o]));
  const outcomeIds = outcomes.map((o) => o.id);

  const measures: Array<{
    id: string;
    outcome_id: string;
    description: string;
    target: string | null;
    value_type: MetricValueType;
    target_direction: TargetDirection;
    sort_order: number;
  }> = [];
  if (outcomeIds.length > 0) {
    const { data: measuresRaw } = await supabase
      .from("success_measures")
      .select(
        "id, outcome_id, description, target, value_type, target_direction, sort_order"
      )
      .in("outcome_id", outcomeIds)
      .eq("archived", false)
      .order("sort_order");
    measures.push(
      ...((measuresRaw ?? []) as Array<{
        id: string;
        outcome_id: string;
        description: string;
        target: string | null;
        value_type: MetricValueType;
        target_direction: TargetDirection;
        sort_order: number;
      }>)
    );
  }

  const measureIds = measures.map((m) => m.id);
  const entriesByMeasureWeek = new Map<
    string,
    { number: number | null; text: string | null }
  >();
  if (measureIds.length > 0) {
    const { data: entriesRaw } = await supabase
      .from("success_measure_entries")
      .select("measure_id, week_ending, value_number, value_text")
      .in("measure_id", measureIds)
      .gte("week_ending", oldestWeek)
      .lte("week_ending", currentWeekEnding);
    for (const row of (entriesRaw ?? []) as Array<{
      measure_id: string;
      week_ending: string;
      value_number: number | null;
      value_text: string | null;
    }>) {
      entriesByMeasureWeek.set(`${row.measure_id}|${row.week_ending}`, {
        number: row.value_number,
        text: row.value_text,
      });
    }
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
    const fnOutcomeIds = outcomes
      .filter((o) => o.function_id === fn.id)
      .map((o) => o.id);
    const fnMeasures = measures.filter((m) =>
      fnOutcomeIds.includes(m.outcome_id)
    );
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
          outcomeTitle: outcomeById.get(m.outcome_id)?.title ?? "—",
          cells: weeks.map((w) => {
            const entry = entriesByMeasureWeek.get(`${m.id}|${w}`) ?? null;
            const status = computeStatus(m, entry);
            return {
              weekEnding: w,
              status,
              displayValue: formatValue(m.value_type, entry),
              numericValue: extractNumericValue(m, entry),
            };
          }),
        };
      }),
    };
  });

  return { weeks, currentWeekEnding, functions: boardFunctions };
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

function formatValue(
  valueType: MetricValueType,
  entry: { number: number | null; text: string | null } | null
): string {
  if (!entry) return "—";
  if (valueType === "text") return entry.text ?? "—";
  if (entry.number == null || !Number.isFinite(entry.number)) return "—";
  if (valueType === "percent") return `${entry.number}%`;
  return String(entry.number);
}
