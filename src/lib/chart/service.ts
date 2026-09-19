import "server-only";

import {
  CSF_AS_OUTCOME_COLUMNS,
  csfAsOutcome,
  type CsfRow,
} from "@/lib/measures/csf-as-outcome";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  FunctionCompetency,
  FunctionDecisionRight,
  FunctionNode,
  FunctionOutcome,
  FunctionRole,
  Profile,
  SuccessMeasure,
  SuccessMeasureEntry,
} from "@/lib/types";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

// Read model for /chart. Loads the entire company's functional tree
// in a small handful of queries and stitches in memory. Every branch
// carries its outcomes, measures, and the most recent measure entry
// so the tree page can show current values without a per-measure
// fetch.

// A critical success factor as the chart shows it. It carried the
// KPIs beneath it until 0216; there is nothing beneath one now, so
// the field is gone rather than always empty.
export type ChartOutcome = FunctionOutcome;

// Kept as a type alias for the detail page which still surfaces
// the LTD split when set explicitly. The org-chart page only shows
// the seat holder (Lead), because L/T/D are three responsibilities
// of one accountable person, not three separate assignments.
export type ChartLtd = {
  lead: Pick<Profile, "id" | "full_name"> | null;
  track: Pick<Profile, "id" | "full_name"> | null;
  decide: Pick<Profile, "id" | "full_name"> | null;
};

export type ChartFunction = FunctionNode & {
  seatHolder: Pick<Profile, "id" | "full_name"> | null;
  // R&R for the chart tree box. Includes the trigger-created default
  // "Lead, Track, Decide" row (is_default=true) sorted first.
  roles: FunctionRole[];
  outcomes: ChartOutcome[];
  children: ChartFunction[]; // recursive: sub-functions
};

export type ChartTree = {
  roots: ChartFunction[];
  roster: Array<Pick<Profile, "id" | "full_name">>;
};

export async function getChartTree(companyId: string): Promise<ChartTree> {
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());

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
      .neq("status", "inactive")
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

  const [{ data: outcomesRaw }, { data: rolesRaw }] = await Promise.all([
    // Outcomes are critical success factors now (migration 0166), so
    // they come from success_measures like everything else and get
    // mapped back to the chart's shape.
    supabase
      .from("success_measures")
      .select(CSF_AS_OUTCOME_COLUMNS)
      .in("function_id", functionIds)
      .eq("archived", false)
      .order("sort_order"),

    // Roles & Responsibilities for the chart tree boxes. Sort is
    // is_default first (default row = sort_order 0), then by
    // sort_order — user-added items follow after the L/T/D baseline.
    supabase
      .from("function_roles")
      .select("*")
      .in("function_id", functionIds)
      .order("is_default", { ascending: false })
      .order("sort_order"),
  ]);

  const outcomes = ((outcomesRaw ?? []) as unknown as CsfRow[]).map(
    csfAsOutcome
  );
  // No entry read here any more. It existed to hang the latest value
  // off each KPI in the chart tree, and the chart tree shows critical
  // success factors, not values: /measures and the dashboard board
  // are where weekly numbers are read. Two queries and a bucketing
  // pass per chart load went with it.

  const rosterById = new Map(roster.map((p) => [p.id, p]));

  const roles = (rolesRaw ?? []) as FunctionRole[];
  const rolesByFunction = new Map<string, FunctionRole[]>();
  for (const role of roles) {
    const arr = rolesByFunction.get(role.function_id) ?? [];
    arr.push(role);
    rolesByFunction.set(role.function_id, arr);
  }

  const outcomesByFunction = new Map<string, ChartOutcome[]>();

  for (const outcome of outcomes) {
    const arr = outcomesByFunction.get(outcome.function_id) ?? [];
    arr.push(outcome);
    outcomesByFunction.set(outcome.function_id, arr);
  }

  // Build the tree. Two passes: enrich each function, then attach
  // to its parent (or the root list). Order within siblings mirrors
  // sort_order which is how we loaded from the DB.
  const nodesById = new Map<string, ChartFunction>();
  for (const f of functions) {
    nodesById.set(f.id, {
      ...f,
      seatHolder: f.lead_id ? rosterById.get(f.lead_id) ?? null : null,
      roles: rolesByFunction.get(f.id) ?? [],
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
// Decision rights and competency indicators are always loaded — the
// Function detail page decides whether to render them based on the
// company's role_descriptions feature flag.
export async function getChartFunctionDetail(functionId: string): Promise<{
  fn: FunctionNode;
  seatHolder: Pick<Profile, "id" | "full_name"> | null;
  parent: Pick<FunctionNode, "id" | "title"> | null;
  children: FunctionNode[];
  roles: FunctionRole[];
  decisionRights: FunctionDecisionRight[];
  competencies: FunctionCompetency[];
  // The function's critical success factors, each with its own weekly
  // entries. They carried a nested `measures` list until 0216; a CSF
  // has nothing under it now, so the entries hang off the CSF itself.
  outcomes: Array<
    FunctionOutcome & { target: string | null; entries: SuccessMeasureEntry[] }
  >;
  roster: Array<Pick<Profile, "id" | "full_name">>;
} | null> {
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());

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
    { data: rolesRaw },
    { data: decisionRightsRaw },
    { data: competenciesRaw },
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
      .from("success_measures")
      .select(CSF_AS_OUTCOME_COLUMNS)
      .eq("function_id", fn.id)
      .eq("archived", false)
      .order("sort_order"),
    supabase
      .from("function_roles")
      .select("*")
      .eq("function_id", fn.id)
      .order("is_default", { ascending: false })
      .order("sort_order"),
    supabase
      .from("function_decision_rights")
      .select("*")
      .eq("function_id", fn.id)
      .order("sort_order"),
    supabase
      .from("function_competencies")
      .select("*")
      .eq("function_id", fn.id)
      .order("sort_order"),
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("company_id", fn.company_id)
      .neq("status", "inactive")
      .order("full_name"),
  ]);

  const outcomes = ((outcomesRaw ?? []) as unknown as CsfRow[]).map(
    csfAsOutcome
  );
  // The function's measures ARE its critical success factors since
  // 0216. This used to read the link table and then fetch whatever it
  // pointed at, which was two round trips to arrive at rows the first
  // query had already selected.
  const measureIds = outcomes.map((o) => o.id);
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
  const seatHolder = fn.lead_id ? rosterById.get(fn.lead_id) ?? null : null;

  const outcomesWithMeasures = outcomes.map((o) => ({
    ...o,
    entries: entriesByMeasure.get(o.id) ?? [],
  }));

  return {
    fn,
    seatHolder,
    parent: parentRaw ?? null,
    children: (childrenRaw ?? []) as FunctionNode[],
    roles: (rolesRaw ?? []) as FunctionRole[],
    decisionRights: (decisionRightsRaw ?? []) as FunctionDecisionRight[],
    competencies: (competenciesRaw ?? []) as FunctionCompetency[],
    outcomes: outcomesWithMeasures,
    roster,
  };
}
