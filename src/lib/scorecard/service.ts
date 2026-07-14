import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { addDays, thisFriday } from "@/lib/dates";
import type {
  FunctionalArea,
  Profile,
  ScorecardEntry,
  ScorecardMetric,
} from "@/lib/types";

// /scorecard read model — Section 8.5. The grid is:
//   sticky first 3 cols   → Area, Metric, Target
//   next 13 cols          → last 13 weeks, newest at left
//
// The service returns everything the grid needs. Entries are indexed
// by (metric_id, week_ending) for O(1) cell lookup during render.

export type AreaWithMetrics = FunctionalArea & {
  accountable: Pick<Profile, "id" | "full_name"> | null;
  metrics: ScorecardMetric[];
};

export type ScorecardData = {
  timezone: string;
  weeks: string[]; // 13 YYYY-MM-DD strings, newest first
  areas: AreaWithMetrics[];
  entries: Map<string, ScorecardEntry>; // key = `${metricId}::${weekEnding}`
  roster: Array<Pick<Profile, "id" | "full_name">>;
  callerIsAccountableForAreaIds: Set<string>;
};

export function entryKey(metricId: string, weekEnding: string): string {
  return `${metricId}::${weekEnding}`;
}

export async function getScorecardData(
  companyId: string,
  callerId: string
): Promise<ScorecardData> {
  const supabase = await createSupabaseServerClient();

  const { data: companyRow } = await supabase
    .from("companies")
    .select("timezone")
    .eq("id", companyId)
    .maybeSingle<{ timezone: string }>();
  const timezone = companyRow?.timezone ?? "America/Anchorage";

  const thisFri = thisFriday(timezone);
  const weeks: string[] = [];
  for (let i = 0; i < 13; i += 1) {
    weeks.push(addDays(thisFri, -7 * i));
  }
  // newest first is what the grid wants (Section 8.5).

  const [{ data: areaRows }, { data: metricRows }, { data: rosterRows }] =
    await Promise.all([
      supabase
        .from("functional_areas")
        .select("*")
        .eq("company_id", companyId)
        .order("sort_order")
        .order("created_at"),
      supabase
        .from("scorecard_metrics")
        .select("*")
        .eq("company_id", companyId)
        .eq("archived", false)
        .order("sort_order")
        .order("created_at"),
      supabase
        .from("profiles")
        .select("id, full_name")
        .eq("company_id", companyId)
        .order("full_name"),
    ]);

  const areas = (areaRows ?? []) as FunctionalArea[];
  const metrics = (metricRows ?? []) as ScorecardMetric[];
  const roster = (rosterRows ?? []) as Pick<Profile, "id" | "full_name">[];
  const rosterById = new Map(roster.map((p) => [p.id, p]));

  const metricIds = metrics.map((m) => m.id);
  const oldestWeek = weeks[weeks.length - 1];

  const { data: entryRows } = metricIds.length
    ? await supabase
        .from("scorecard_entries")
        .select("*")
        .in("metric_id", metricIds)
        .gte("week_ending", oldestWeek)
        .lte("week_ending", thisFri)
    : { data: [] };

  const entryMap = new Map<string, ScorecardEntry>();
  for (const entry of (entryRows ?? []) as ScorecardEntry[]) {
    entryMap.set(entryKey(entry.metric_id, entry.week_ending), entry);
  }

  const metricsByArea = new Map<string, ScorecardMetric[]>();
  for (const metric of metrics) {
    if (!metricsByArea.has(metric.functional_area_id)) {
      metricsByArea.set(metric.functional_area_id, []);
    }
    metricsByArea.get(metric.functional_area_id)!.push(metric);
  }

  const enrichedAreas: AreaWithMetrics[] = areas.map((area) => ({
    ...area,
    accountable: area.accountable_id
      ? rosterById.get(area.accountable_id) ?? null
      : null,
    metrics: metricsByArea.get(area.id) ?? [],
  }));

  const callerIsAccountableForAreaIds = new Set(
    areas
      .filter((area) => area.accountable_id === callerId)
      .map((area) => area.id)
  );

  return {
    timezone,
    weeks,
    areas: enrichedAreas,
    entries: entryMap,
    roster,
    callerIsAccountableForAreaIds,
  };
}
