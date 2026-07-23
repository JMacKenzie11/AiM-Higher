import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  FunctionNode,
  FunctionOutcome,
  Profile,
  SuccessMeasure,
  SuccessMeasureEntry,
} from "@/lib/types";

// Read model for /chart. Loads the entire company's functional tree
// in a small handful of queries and stitches in memory. Every branch
// carries its outcomes, measures, and the most recent measure entry
// so the tree page can show current values without a per-measure
// fetch.

export type ChartMeasureWithLatest = SuccessMeasure & {
  latestEntry: SuccessMeasureEntry | null;
};

export type ChartOutcome = FunctionOutcome & {
  measures: ChartMeasureWithLatest[];
};

export type ChartLtd = {
  lead: Pick<Profile, "id" | "full_name"> | null;
  track: Pick<Profile, "id" | "full_name"> | null;
  decide: Pick<Profile, "id" | "full_name"> | null;
};

export type ChartFunction = FunctionNode & {
  ltd: ChartLtd;
  outcomes: ChartOutcome[];
  children: ChartFunction[]; // recursive: sub-functions
};

export type ChartTree = {
  roots: ChartFunction[];
  roster: Array<Pick<Profile, "id" | "full_name">>;
};

export async function getChartTree(companyId: string): Promise<ChartTree> {
  const supabase = await createSupabaseServerClient();

  const [
    { data: functionsRaw },
    { data: profilesRaw },
  ] = await Promise.all([
    supabase
      .from("functions")
      .select("*")
      .eq("company_id", companyId)
      .eq("archived", false)
      .order("sort_order"),
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("company_id", companyId)
      .eq("status", "active")
      .order("full_name"),
  ]);

  const functions = (functionsRaw ?? []) as FunctionNode[];
  const roster = (profilesRaw ?? []) as Array<
    Pick<Profile, "id" | "full_name">
  >;

  if (functions.length === 0) {
    return { roots: [], roster };
  }

  const functionIds = functions.map((f) => f.id);

  const [{ data: outcomesRaw }, { data: measuresRaw }] = await Promise.all([
    supabase
      .from("function_outcomes")
      .select("*")
      .in("function_id", functionIds)
      .eq("archived", false)
      .order("sort_order"),
    // Pull all measures under all outcomes for this company in one
    // round-trip by joining outcomes back to their function.
    supabase
      .from("success_measures")
      .select("*, function_outcomes!inner(function_id)")
      .eq("archived", false)
      .in("function_outcomes.function_id", functionIds)
      .order("sort_order"),
  ]);

  const outcomes = (outcomesRaw ?? []) as FunctionOutcome[];
  const measures = ((measuresRaw ?? []) as Array<
    SuccessMeasure & { function_outcomes?: unknown }
  >).map((row) => {
    const { function_outcomes: _drop, ...rest } = row;
    void _drop;
    return rest as SuccessMeasure;
  });

  // Latest entry per measure — one round-trip, then bucket in memory.
  const measureIds = measures.map((m) => m.id);
  const latestByMeasure = new Map<string, SuccessMeasureEntry>();
  if (measureIds.length > 0) {
    const { data: entriesRaw } = await supabase
      .from("success_measure_entries")
      .select("*")
      .in("measure_id", measureIds)
      .order("week_ending", { ascending: false });
    const entries = (entriesRaw ?? []) as SuccessMeasureEntry[];
    for (const entry of entries) {
      if (!latestByMeasure.has(entry.measure_id)) {
        latestByMeasure.set(entry.measure_id, entry);
      }
    }
  }

  const rosterById = new Map(roster.map((p) => [p.id, p]));

  const outcomesByFunction = new Map<string, ChartOutcome[]>();
  const measuresByOutcome = new Map<string, ChartMeasureWithLatest[]>();

  for (const measure of measures) {
    const arr = measuresByOutcome.get(measure.outcome_id) ?? [];
    arr.push({
      ...measure,
      latestEntry: latestByMeasure.get(measure.id) ?? null,
    });
    measuresByOutcome.set(measure.outcome_id, arr);
  }

  for (const outcome of outcomes) {
    const arr = outcomesByFunction.get(outcome.function_id) ?? [];
    arr.push({
      ...outcome,
      measures: measuresByOutcome.get(outcome.id) ?? [],
    });
    outcomesByFunction.set(outcome.function_id, arr);
  }

  // Build the tree. Two passes: enrich each function, then attach
  // to its parent (or the root list). Order within siblings mirrors
  // sort_order which is how we loaded from the DB.
  const resolveLtd = (f: FunctionNode): ChartLtd => {
    const lead = f.lead_id ? rosterById.get(f.lead_id) ?? null : null;
    // Track and Decide fall back to Lead when unset — that's the
    // common case (one accountable person for all three roles).
    const trackId = f.track_id ?? f.lead_id;
    const decideId = f.decide_id ?? f.lead_id;
    return {
      lead,
      track: trackId ? rosterById.get(trackId) ?? null : null,
      decide: decideId ? rosterById.get(decideId) ?? null : null,
    };
  };

  const nodesById = new Map<string, ChartFunction>();
  for (const f of functions) {
    nodesById.set(f.id, {
      ...f,
      ltd: resolveLtd(f),
      outcomes: outcomesByFunction.get(f.id) ?? [],
      children: [],
    });
  }
  const roots: ChartFunction[] = [];
  for (const node of nodesById.values()) {
    if (node.parent_function_id) {
      const parent = nodesById.get(node.parent_function_id);
      if (parent) {
        parent.children.push(node);
        continue;
      }
    }
    roots.push(node);
  }

  return { roots, roster };
}

// Detail-page loader for a single function. Returns the function
// plus its outcomes, measures, and a wider slice of entry history
// (last 13 weeks) per measure so a chart could render a trend later.
export async function getChartFunctionDetail(functionId: string): Promise<{
  fn: FunctionNode;
  ltd: ChartLtd;
  parent: Pick<FunctionNode, "id" | "title"> | null;
  children: FunctionNode[];
  outcomes: Array<
    FunctionOutcome & {
      measures: Array<SuccessMeasure & { entries: SuccessMeasureEntry[] }>;
    }
  >;
  roster: Array<Pick<Profile, "id" | "full_name">>;
} | null> {
  const supabase = await createSupabaseServerClient();

  const { data: fn } = await supabase
    .from("functions")
    .select("*")
    .eq("id", functionId)
    .maybeSingle<FunctionNode>();
  if (!fn) return null;

  const [
    { data: parentRaw },
    { data: childrenRaw },
    { data: outcomesRaw },
    { data: rosterRaw },
  ] = await Promise.all([
    fn.parent_function_id
      ? supabase
          .from("functions")
          .select("id, title")
          .eq("id", fn.parent_function_id)
          .maybeSingle<Pick<FunctionNode, "id" | "title">>()
      : Promise.resolve({ data: null }),
    supabase
      .from("functions")
      .select("*")
      .eq("parent_function_id", fn.id)
      .eq("archived", false)
      .order("sort_order"),
    supabase
      .from("function_outcomes")
      .select("*")
      .eq("function_id", fn.id)
      .eq("archived", false)
      .order("sort_order"),
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("company_id", fn.company_id)
      .eq("status", "active")
      .order("full_name"),
  ]);

  const outcomes = (outcomesRaw ?? []) as FunctionOutcome[];
  const outcomeIds = outcomes.map((o) => o.id);

  const measures: SuccessMeasure[] = [];
  if (outcomeIds.length > 0) {
    const { data: measuresRaw } = await supabase
      .from("success_measures")
      .select("*")
      .in("outcome_id", outcomeIds)
      .eq("archived", false)
      .order("sort_order");
    measures.push(...((measuresRaw ?? []) as SuccessMeasure[]));
  }

  const measureIds = measures.map((m) => m.id);
  const entriesByMeasure = new Map<string, SuccessMeasureEntry[]>();
  if (measureIds.length > 0) {
    const { data: entriesRaw } = await supabase
      .from("success_measure_entries")
      .select("*")
      .in("measure_id", measureIds)
      .order("week_ending", { ascending: false })
      .limit(13 * measureIds.length);
    for (const entry of (entriesRaw ?? []) as SuccessMeasureEntry[]) {
      const arr = entriesByMeasure.get(entry.measure_id) ?? [];
      arr.push(entry);
      entriesByMeasure.set(entry.measure_id, arr);
    }
  }

  const roster = (rosterRaw ?? []) as Array<
    Pick<Profile, "id" | "full_name">
  >;
  const rosterById = new Map(roster.map((p) => [p.id, p]));
  const ltd: ChartLtd = {
    lead: fn.lead_id ? rosterById.get(fn.lead_id) ?? null : null,
    track: (fn.track_id ?? fn.lead_id)
      ? rosterById.get(fn.track_id ?? fn.lead_id!) ?? null
      : null,
    decide: (fn.decide_id ?? fn.lead_id)
      ? rosterById.get(fn.decide_id ?? fn.lead_id!) ?? null
      : null,
  };

  const outcomesWithMeasures = outcomes.map((o) => ({
    ...o,
    measures: measures
      .filter((m) => m.outcome_id === o.id)
      .map((m) => ({
        ...m,
        entries: entriesByMeasure.get(m.id) ?? [],
      })),
  }));

  return {
    fn,
    ltd,
    parent: parentRaw ?? null,
    children: (childrenRaw ?? []) as FunctionNode[],
    outcomes: outcomesWithMeasures,
    roster,
  };
}
