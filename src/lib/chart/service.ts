import "server-only";

import {
  CSF_AS_OUTCOME_COLUMNS,
  csfAsOutcome,
  kpisByCsf,
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

  const [{ data: outcomesRaw }, { data: measuresRaw }, { data: rolesRaw }] = await Promise.all([
    // Outcomes are critical success factors now (migration 0166), so
    // they come from success_measures like everything else and get
    // mapped back to the chart's shape.
    supabase
      .from("success_measures")
      .select(CSF_AS_OUTCOME_COLUMNS)
      .eq("kind", "csf")
      .in("function_id", functionIds)
      .eq("archived", false)
      .order("sort_order"),
    // KPIs reach their function directly now rather than through an
    // outcome join, which is both simpler and one fewer table.
    supabase
      .from("success_measures")
      .select("*")
      .eq("kind", "kpi")
      .eq("archived", false)
      .in("function_id", functionIds)
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
  const measures = (measuresRaw ?? []) as SuccessMeasure[];

  // Which KPI drives which CSF. One read for the whole company; the
  // table is small (one row per pairing) and the alternative is a
  // join that has to be repeated on every query touching measures.
  const outcomeIds = outcomes.map((o) => o.id);
  const links =
    outcomeIds.length === 0
      ? []
      : (((
          await supabase
            .from("csf_kpi_links")
            .select("csf_id, kpi_id")
            .in("csf_id", outcomeIds)
        ).data ?? []) as Array<{ csf_id: string; kpi_id: string }>);

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

  const roles = (rolesRaw ?? []) as FunctionRole[];
  const rolesByFunction = new Map<string, FunctionRole[]>();
  for (const role of roles) {
    const arr = rolesByFunction.get(role.function_id) ?? [];
    arr.push(role);
    rolesByFunction.set(role.function_id, arr);
  }

  const outcomesByFunction = new Map<string, ChartOutcome[]>();
  const measuresByOutcome = new Map<string, ChartMeasureWithLatest[]>();

  // Which CSF each KPI drives lives in its own table now. A KPI with
  // no link is not filed anywhere, which is the same outcome the old
  // null-parent guard produced, without a null column to check.
  const grouped = kpisByCsf(
    measures.map((m) => ({
      ...m,
      latestEntry: latestByMeasure.get(m.id) ?? null,
    })),
    links
  );
  for (const [csfId, arr] of grouped) measuresByOutcome.set(csfId, arr);

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
      .eq("kind", "csf")
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
  const outcomeIds = outcomes.map((o) => o.id);

  // KPIs are reached through the link table now, not an outcome_id
  // column. Read the links first so the second query asks for exactly
  // the measures this function's CSFs drive.
  const links =
    outcomeIds.length === 0
      ? []
      : (((
          await supabase
            .from("csf_kpi_links")
            .select("csf_id, kpi_id")
            .in("csf_id", outcomeIds)
        ).data ?? []) as Array<{ csf_id: string; kpi_id: string }>);

  const measures: SuccessMeasure[] = [];
  const kpiIds = Array.from(new Set(links.map((l) => l.kpi_id)));
  if (kpiIds.length > 0) {
    const { data: measuresRaw } = await supabase
      .from("success_measures")
      .select("*")
      .in("id", kpiIds)
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
  const seatHolder = fn.lead_id ? rosterById.get(fn.lead_id) ?? null : null;

  const measuresByCsf = kpisByCsf(
    measures.map((m) => ({ ...m, entries: entriesByMeasure.get(m.id) ?? [] })),
    links
  );
  const outcomesWithMeasures = outcomes.map((o) => ({
    ...o,
    measures: measuresByCsf.get(o.id) ?? [],
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
