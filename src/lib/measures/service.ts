import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { addDays, thisFriday } from "@/lib/dates";
import { firstCsfIdByKpi } from "@/lib/measures/csf-as-outcome";
import type {
  UpdateFrequency, MetricValueType, TargetDirection } from "@/lib/types";

// Reads for the Success Tracking surfaces: the /measures batch
// page and the dashboard "Pending this week" widget.
//
// Ownership is derived from functions.lead_id / track_id — the person
// in the
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
    // Lead OR Track, matching who upsertMeasureEntryAction lets write.
    // These were two different rules: the page filtered on `leader_id`
    // (renamed to `lead_id` in migration 0020, so it matched nobody)
    // while the write allowed lead or track.
    functionsQuery = functionsQuery.or(
      `lead_id.eq.${userId},track_id.eq.${userId}`
    );
  }
  const { data: functionRows } = await functionsQuery;
  const functions = (functionRows ?? []) as Array<{ id: string; title: string }>;
  if (functions.length === 0) return { measures: [], weekEnding };
  const functionIds = functions.map((f) => f.id);
  const functionTitleById = new Map(functions.map((f) => [f.id, f.title]));

  // The critical success factors under those functions. These are
  // success_measures rows tagged csf since migration 0166, and their
  // `description` is what the outcome called `title`.
  const { data: outcomeRows } = await supabase
    .from("success_measures")
    .select("id, description, function_id")
    .eq("kind", "csf")
    .eq("archived", false)
    .in("function_id", functionIds);
  const outcomes = ((outcomeRows ?? []) as Array<{
    id: string;
    description: string;
    function_id: string;
  }>).map((c) => ({
    id: c.id,
    title: c.description,
    function_id: c.function_id,
  }));
  if (outcomes.length === 0) return { measures: [], weekEnding };
  const outcomeById = new Map(outcomes.map((o) => [o.id, o]));
  const outcomeIds = outcomes.map((o) => o.id);

  // The KPIs those CSFs are driven by. The pairing lives in its own
  // table now, so read the links first and ask for exactly those.
  const { data: linkRows } = await supabase
    .from("csf_kpi_links")
    .select("csf_id, kpi_id")
    .in("csf_id", outcomeIds);
  const links = (linkRows ?? []) as Array<{ csf_id: string; kpi_id: string }>;
  const csfIdByKpi = firstCsfIdByKpi(links);
  const kpiIds = Array.from(csfIdByKpi.keys());
  if (kpiIds.length === 0) return { measures: [], weekEnding };

  const { data: measureRows } = await supabase
    .from("success_measures")
    .select(
      "id, description, target, value_type, target_direction, auto_track, archived, sort_order"
    )
    .in("id", kpiIds)
    .eq("archived", false)
    .order("sort_order");
  const measures = ((measureRows ?? []) as Array<{
    id: string;
    description: string;
    target: string | null;
    value_type: MetricValueType;
    target_direction: TargetDirection;
    auto_track: boolean;
    sort_order: number;
  }>).map((m) => ({ ...m, csfId: csfIdByKpi.get(m.id) ?? "" }));
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
    const outcome = outcomeById.get(m.csfId);
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
  update_frequency: UpdateFrequency;
  target_hint: string | null;
  currentValue: { number: number | null; text: string | null } | null;
  recent: Array<{
    weekEnding: string;
    number: number | null;
    text: string | null;
  }>;
};

// A CSF is a measure now, so it carries everything a measure does:
// a target, a value type, a direction, this week's value and the
// recent trail. Phase 4 of the CSF/KPI migration.
//
// `target` stays nullable on purpose. Decided 2026-09-04: a company
// may name its CSFs and come back to set targets later, so a CSF
// without one is a normal state, not a failure. Anything reading
// this must render it as "no target set", never as off target.
export type MeasureTreeOutcome = {
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
  measures: MeasureTreeMeasure[];
};

export type MeasureTreeFunction = {
  id: string;
  title: string;
  // Whether this caller can write values against this function.
  // Per function, not per user: a leader reads the whole company and
  // types only into their own seats, and an admin or guide types
  // everywhere. Mirrors upsertMeasureEntryAction exactly, which is
  // the rule the server will actually enforce.
  canLog: boolean;
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

  // Everyone in the company reads every function. These are the
  // company's commitments to itself, and someone who cannot see what
  // their own function is held to cannot align to it. Writing stays
  // narrow: `canLog` below decides who gets an input instead of a
  // read-only value.
  const functionsQuery = supabase
    .from("functions")
    .select("id, title, sort_order, parent_function_id, lead_id, track_id")
    .eq("company_id", companyId)
    .eq("archived", false);
  const { data: functionRows } = await functionsQuery;
  const functions = (functionRows ?? []) as Array<{
    id: string;
    title: string;
    lead_id: string | null;
    track_id: string | null;
    sort_order: number;
    parent_function_id: string | null;
  }>;
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
  const functionIds = orderedFunctions.map((f) => f.id);

  // CSF measures ARE the outcomes now (migration 0166). Same rows,
  // reached by function + kind instead of through function_outcomes.
  // The name mapping matters: a CSF's `description` holds what the
  // outcome called `title`, and its `detail` holds what the outcome
  // called `description`.
  const { data: csfRows } = await supabase
    .from("success_measures")
    .select(
      "id, description, detail, target, value_type, target_direction, auto_track, update_frequency, target_hint, function_id, sort_order"
    )
    .in("function_id", functionIds)
    .eq("kind", "csf")
    .eq("archived", false);
  const outcomes = ((csfRows ?? []) as Array<{
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
  }>).map((c) => ({
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
  const outcomeIds = outcomes.map((o) => o.id);

  // Which KPIs hang off those CSFs. Read as a list per CSF from the
  // start, even though the authoring UI allows only one CSF per KPI
  // today — writing this for a single parent would mean rewriting it
  // the day that rule is widened, which is the whole reason the link
  // table is many-to-many.
  const linkRows =
    outcomeIds.length === 0
      ? []
      : (((
          await supabase
            .from("csf_kpi_links")
            .select("csf_id, kpi_id")
            .in("csf_id", outcomeIds)
        ).data ?? []) as Array<{ csf_id: string; kpi_id: string }>);
  const kpiIds = Array.from(new Set(linkRows.map((l) => l.kpi_id)));

  const measureRows =
    kpiIds.length === 0
      ? []
      : (((
          await supabase
            .from("success_measures")
            .select(
              "id, description, target, value_type, target_direction, auto_track, update_frequency, target_hint, sort_order"
            )
            .in("id", kpiIds)
            .eq("archived", false)
            .order("sort_order")
        ).data ?? []) as Array<{
          id: string;
          description: string;
          target: string | null;
          value_type: MetricValueType;
          target_direction: TargetDirection;
          auto_track: boolean;
          update_frequency: UpdateFrequency;
          target_hint: string | null;
          sort_order: number;
        }>);

  const oldest = addDays(weekEnding, -35);
  // CSF ids ride along: a CSF is measured now, so it has its own
  // weekly entries and its own recent trail, exactly like a KPI.
  const measureIds = [...outcomeIds, ...measureRows.map((m) => m.id)];
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

  const shapedById = new Map<string, MeasureTreeMeasure>();
  for (const m of measureRows) {
    const recent = entriesByMeasure.get(m.id) ?? [];
    const current = recent.find((r) => r.weekEnding === weekEnding) ?? null;
    shapedById.set(m.id, {
      id: m.id,
      description: m.description,
      target: m.target,
      value_type: m.value_type,
      target_direction: m.target_direction,
      auto_track: m.auto_track,
      update_frequency: m.update_frequency ?? "weekly",
      target_hint: m.target_hint,
      currentValue: current
        ? { number: current.number, text: current.text }
        : null,
      recent,
    });
  }

  // Walk the links rather than a parent column. measureRows is
  // already ordered by sort_order, so filtering it per CSF preserves
  // that order without re-sorting.
  const kpiIdsByCsf = new Map<string, Set<string>>();
  for (const link of linkRows) {
    const set = kpiIdsByCsf.get(link.csf_id) ?? new Set<string>();
    set.add(link.kpi_id);
    kpiIdsByCsf.set(link.csf_id, set);
  }
  const measuresByOutcome = new Map<string, MeasureTreeMeasure[]>();
  for (const csfId of outcomeIds) {
    const ids = kpiIdsByCsf.get(csfId);
    if (!ids || ids.size === 0) continue;
    const ordered = measureRows
      .filter((m) => ids.has(m.id))
      .map((m) => shapedById.get(m.id))
      .filter((m): m is MeasureTreeMeasure => Boolean(m));
    if (ordered.length > 0) measuresByOutcome.set(csfId, ordered);
  }

  const outcomesByFunction = new Map<string, MeasureTreeOutcome[]>();
  outcomes.sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.title.localeCompare(b.title);
  });
  for (const o of outcomes) {
    const csfRecent = entriesByMeasure.get(o.id) ?? [];
    const csfCurrent =
      csfRecent.find((r) => r.weekEnding === weekEnding) ?? null;
    const shaped: MeasureTreeOutcome = {
      id: o.id,
      title: o.title,
      description: o.description,
      target: o.target,
      value_type: o.value_type,
      target_direction: o.target_direction,
      auto_track: o.auto_track,
      update_frequency: o.update_frequency,
      target_hint: o.target_hint,
      currentValue: csfCurrent
        ? { number: csfCurrent.number, text: csfCurrent.text }
        : null,
      recent: csfRecent,
      measures: measuresByOutcome.get(o.id) ?? [],
    };
    const list = outcomesByFunction.get(o.function_id) ?? [];
    list.push(shaped);
    outcomesByFunction.set(o.function_id, list);
  }

  const tree: MeasureTreeFunction[] = orderedFunctions.map((f) => ({
    id: f.id,
    title: f.title,
    // Same rule upsertMeasureEntryAction enforces. Computed here so
    // the page never renders an input the server would refuse.
    canLog: includeAll || f.lead_id === userId || f.track_id === userId,
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
