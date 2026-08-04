import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { addDays, thisFriday } from "@/lib/dates";
import type { MetricValueType, TargetDirection } from "@/lib/types";

// Reads for the Performance Tracking surfaces: the /measures batch
// page and the dashboard "Pending this week" widget.
//
// Ownership is derived from function.leader_id — the person in the
// seat is the person on the hook for the numbers.

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
  timezone: string
): Promise<{ measures: OwnedMeasure[]; weekEnding: string }> {
  const supabase = await createSupabaseServerClient();
  const weekEnding = thisFriday(timezone);

  // Functions the caller leads for this company.
  const { data: functionRows } = await supabase
    .from("functions")
    .select("id, title")
    .eq("company_id", companyId)
    .eq("leader_id", userId)
    .eq("archived", false);
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
