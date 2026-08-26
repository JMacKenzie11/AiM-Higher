import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { addDays, thisFriday } from "@/lib/dates";
import type { MetricValueType, TargetDirection } from "@/lib/types";

// Reads for the Success Tracking surfaces: the /measures batch
// page and the dashboard "Pending this week" widget.
//
// Ownership is derived from function.leader_id — the person in the
// seat is the person on the hook for the numbers. Admins (system_admin
// and company_admin) pass includeAllInCompany=true to see and enter
// values for every function in the company, e.g. when a leader is out
// or a seat is vacant.

export type OwnedMeasure = {
  id: string;
  description: string;
  target: string | null;
  value_type: MetricValueType;
  target_direction: TargetDirection;
  auto_track: boolean;
  functionId: string;
  functionTitle: string;
  outcomeTitle: string;
  currentValue: { number: number | null; text: string | null } | null;
  recent: Array<{
    weekEnding: string;
    number: number | null;
    text: string | null;
  }>;
};

// Everything the caller (user_id) owns for the given company. Called
// by the batch page + the dashboard widget. Returned rows are
// sorted alphabetically by function then measure so a user with
// several functions gets a stable read.
export async function getMeasuresOwnedBy(
  companyId: string,
  userId: string,
  timezone: string,
  includeAllInCompany: boolean = false
): Promise<{ measures: OwnedMeasure[]; weekEnding: string }> {
  const supabase = await createSupabaseServerClient();
  const weekEnding = thisFriday(timezone);

  // Functions the caller leads for this company — or every function
  // in the company when the caller is an admin covering for others.
  let functionsQuery = supabase
    .from("functions")
    .select("id, title")
    .eq("company_id", companyId)
    .eq("archived", false);
  if (!includeAllInCompany) {
    functionsQuery = functionsQuery.eq("leader_id", userId);
  }
  const { data: functionRows } = await functionsQuery;
  const functions = (functionRows ?? []) as Array<{ id: string; title: string }>;
  if (functions.length === 0) return { measures: [], weekEnding };
  const functionIds = functions.map((f) => f.id);
  const functionTitleById = new Map(functions.map((f) => [f.id, f.title]));

  // Outcomes under those functions.
  const { data: outcomeRows } = await supabase
    .from("function_outcomes")
    .select("id, title, function_id")
    .in("function_id", functionIds);
  const outcomes = (outcomeRows ?? []) as Array<{
    id: string;
    title: string;
    function_id: string;
  }>;
  if (outcomes.length === 0) return { measures: [], weekEnding };
  const outcomeById = new Map(outcomes.map((o) => [o.id, o]));
  const outcomeIds = outcomes.map((o) => o.id);

  // Measures under those outcomes.
  const { data: measureRows } = await supabase
    .from("success_measures")
    .select(
      "id, description, target, value_type, target_direction, auto_track, outcome_id, archived, sort_order"
    )
    .in("outcome_id", outcomeIds)
    .eq("archived", false)
    .order("sort_order");
  const measures = (measureRows ?? []) as Array<{
    id: string;
    description: string;
    target: string | null;
    value_type: MetricValueType;
    target_direction: TargetDirection;
    auto_track: boolean;
    outcome_id: string;
    sort_order: number;
  }>;
  if (measures.length === 0) return { measures: [], weekEnding };

  // Recent 6 weeks of entries — one round trip for all measures.
  const oldest = addDays(weekEnding, -35);
  const { data: entryRows } = await supabase
    .from("success_measure_entries")
    .select("measure_id, week_ending, value_number, value_text")
    .in(
      "measure_id",
      measures.map((m) => m.id)
    )
    .gte("week_ending", oldest)
    .lte("week_ending", weekEnding)
    .order("week_ending", { ascending: false });
  type EntryRow = {
    measure_id: string;
    week_ending: string;
    value_number: number | null;
    value_text: string | null;
  };
  const entriesByMeasure = new Map<string, EntryRow[]>();
  for (const row of (entryRows ?? []) as EntryRow[]) {
    const list = entriesByMeasure.get(row.measure_id) ?? [];
    list.push(row);
    entriesByMeasure.set(row.measure_id, list);
  }

  const owned: OwnedMeasure[] = measures.map((m) => {
    const outcome = outcomeById.get(m.outcome_id);
    const rows = entriesByMeasure.get(m.id) ?? [];
    const current = rows.find((r) => r.week_ending === weekEnding);
    return {
      id: m.id,
      description: m.description,
      target: m.target,
      value_type: m.value_type,
      target_direction: m.target_direction,
      auto_track: m.auto_track,
      functionId: outcome?.function_id ?? "",
      functionTitle: functionTitleById.get(outcome?.function_id ?? "") ?? "—",
      outcomeTitle: outcome?.title ?? "—",
      currentValue: current
        ? { number: current.value_number, text: current.value_text }
        : null,
      recent: rows.map((r) => ({
        weekEnding: r.week_ending,
        number: r.value_number,
        text: r.value_text,
      })),
    };
  });

  owned.sort((a, b) => {
    if (a.functionTitle !== b.functionTitle) {
      return a.functionTitle.localeCompare(b.functionTitle);
    }
    return a.description.localeCompare(b.description);
  });
  return { measures: owned, weekEnding };
}

// ---- Tree read for the /measures manager -------------------------
// Nested functions → outcomes → measures shape, with recent entries
// attached. Powers the combined author + track surface that replaced
// the chart-side measures section. Admins get every function in the
// company (including ones with no outcomes yet, so they can author
// from scratch). Non-admins only get functions they lead.

export type MeasureTreeMeasure = {
  id: string;
  description: string;
  target: string | null;
  value_type: MetricValueType;
  target_direction: TargetDirection;
  auto_track: boolean;
  target_hint: string | null;
  currentValue: { number: number | null; text: string | null } | null;
  recent: Array<{
    weekEnding: string;
    number: number | null;
    text: string | null;
  }>;
};

export type MeasureTreeOutcome = {
  id: string;
  title: string;
  description: string | null;
  measures: MeasureTreeMeasure[];
};

export type MeasureTreeFunction = {
  id: string;
  title: string;
  outcomes: MeasureTreeOutcome[];
};

export async function getMeasuresTree(
  companyId: string,
  userId: string,
  timezone: string,
  includeAll: boolean
): Promise<{ functions: MeasureTreeFunction[]; weekEnding: string }> {
  const supabase = await createSupabaseServerClient();
  const weekEnding = thisFriday(timezone);

  let functionsQuery = supabase
    .from("functions")
    .select("id, title, sort_order, parent_function_id")
    .eq("company_id", companyId)
    .eq("archived", false);
  if (!includeAll) {
    functionsQuery = functionsQuery.eq("leader_id", userId);
  }
  const { data: functionRows } = await functionsQuery;
  const functions = (functionRows ?? []) as Array<{
    id: string;
    title: string;
    sort_order: number;
    parent_function_id: string | null;
  }>;
  if (functions.length === 0) return { functions: [], weekEnding };
  // Admins / guides see the whole company — order by hierarchy so
  // Visionary sits at the top, Integrator second, and every other
  // function follows its parent (depth-first pre-order). Leaders
  // see only their own seats, so the tree can't be reconstructed
  // meaningfully; fall back to alphabetical.
  const orderedFunctions = includeAll
    ? orderFunctionsByHierarchy(functions)
    : [...functions].sort((a, b) => a.title.localeCompare(b.title));
  const functionIds = orderedFunctions.map((f) => f.id);

  const { data: outcomeRows } = await supabase
    .from("function_outcomes")
    .select("id, title, description, function_id, sort_order")
    .in("function_id", functionIds)
    .eq("archived", false);
  const outcomes = (outcomeRows ?? []) as Array<{
    id: string;
    title: string;
    description: string | null;
    function_id: string;
    sort_order: number;
  }>;
  const outcomeIds = outcomes.map((o) => o.id);

  const measureRows =
    outcomeIds.length === 0
      ? []
      : ((
          await supabase
            .from("success_measures")
            .select(
              "id, description, target, value_type, target_direction, auto_track, target_hint, outcome_id, sort_order"
            )
            .in("outcome_id", outcomeIds)
            .eq("archived", false)
            .order("sort_order")
        ).data ?? []) as Array<{
          id: string;
          description: string;
          target: string | null;
          value_type: MetricValueType;
          target_direction: TargetDirection;
          auto_track: boolean;
          target_hint: string | null;
          outcome_id: string;
          sort_order: number;
        }>;

  const oldest = addDays(weekEnding, -35);
  const measureIds = measureRows.map((m) => m.id);
  const entryRows =
    measureIds.length === 0
      ? []
      : ((
          await supabase
            .from("success_measure_entries")
            .select("measure_id, week_ending, value_number, value_text")
            .in("measure_id", measureIds)
            .gte("week_ending", oldest)
            .lte("week_ending", weekEnding)
            .order("week_ending", { ascending: false })
        ).data ?? []) as Array<{
          measure_id: string;
          week_ending: string;
          value_number: number | null;
          value_text: string | null;
        }>;

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

  const measuresByOutcome = new Map<string, MeasureTreeMeasure[]>();
  for (const m of measureRows) {
    const recent = entriesByMeasure.get(m.id) ?? [];
    const current = recent.find((r) => r.weekEnding === weekEnding) ?? null;
    const shaped: MeasureTreeMeasure = {
      id: m.id,
      description: m.description,
      target: m.target,
      value_type: m.value_type,
      target_direction: m.target_direction,
      auto_track: m.auto_track,
      target_hint: m.target_hint,
      currentValue: current
        ? { number: current.number, text: current.text }
        : null,
      recent,
    };
    const list = measuresByOutcome.get(m.outcome_id) ?? [];
    list.push(shaped);
    measuresByOutcome.set(m.outcome_id, list);
  }

  const outcomesByFunction = new Map<string, MeasureTreeOutcome[]>();
  outcomes.sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.title.localeCompare(b.title);
  });
  for (const o of outcomes) {
    const shaped: MeasureTreeOutcome = {
      id: o.id,
      title: o.title,
      description: o.description,
      measures: measuresByOutcome.get(o.id) ?? [],
    };
    const list = outcomesByFunction.get(o.function_id) ?? [];
    list.push(shaped);
    outcomesByFunction.set(o.function_id, list);
  }

  const tree: MeasureTreeFunction[] = orderedFunctions.map((f) => ({
    id: f.id,
    title: f.title,
    outcomes: outcomesByFunction.get(f.id) ?? [],
  }));

  return { functions: tree, weekEnding };
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
