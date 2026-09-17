import "server-only";

import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Quarter } from "@/lib/types";
// Imported for local use AND re-exported, so every existing importer
// keeps working while the implementation lives outside the
// server-only boundary.
import {
  calendarQuarterOf,
  type CalendarQuarter,
} from "@/lib/quarters/calendar";

export { calendarQuarterOf, type CalendarQuarter };
import { getCurrentInstanceConfig } from "@/lib/instances/current";

// Read-side helpers for quarters. All calls go through the RLS-scoped
// server client so we can trust the user only sees their own company.

export type QuarterWithCounts = Quarter & { priority_count: number };

export async function getQuartersForCompany(
  companyId: string
): Promise<QuarterWithCounts[]> {
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());

  const { data: quarters, error } = await supabase
    .from("quarters")
    .select("*")
    .eq("company_id", companyId)
    .order("start_date", { ascending: false });

  if (error || !quarters) return [];

  // Batch a single priority count query. Fine at v1 volumes.
  const ids = quarters.map((q) => q.id);
  if (ids.length === 0) return [];

  const { data: priorities } = await supabase
    .from("priorities")
    .select("id, quarter_id")
    .in("quarter_id", ids);

  const counts = new Map<string, number>();
  for (const row of priorities ?? []) {
    counts.set(row.quarter_id, (counts.get(row.quarter_id) ?? 0) + 1);
  }

  return (quarters as Quarter[]).map((q) => ({
    ...q,
    priority_count: counts.get(q.id) ?? 0,
  }));
}

// React.cache dedupes calls with the same companyId within a single
// request — dashboard/plan/commitments loaders all reach for this and
// used to hit Supabase separately.
export const getCurrentQuarter = cache(
  async (companyId: string): Promise<Quarter | null> => {
    const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
    const { data } = await supabase
      .from("quarters")
      .select("*")
      .eq("company_id", companyId)
      .eq("status", "open")
      .maybeSingle<Quarter>();
    return data ?? null;
  }
);

// Calendar-quarter helpers used by the "Open next quarter" prefill.
// v1 assumes calendar quarters; the spec doesn't call for fiscal quarters.




export function nextCalendarQuarter(after: CalendarQuarter): CalendarQuarter {
  const end = new Date(`${after.endDate}T00:00:00Z`);
  const dayAfter = new Date(end);
  dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
  return calendarQuarterOf(dayAfter);
}

// What the Quarter card on a company's settings page needs.
//
// One place, because the card shows three things that have to agree:
// the quarter that is open, the dates it would suggest for the next
// one, and how many priorities would move. Computed apart, the count
// could describe a different quarter from the one named above it.
export type QuarterCardData = {
  openQuarter: Pick<Quarter, "id" | "label" | "start_date" | "end_date"> | null;
  suggestion: CalendarQuarter;
  carryCount: number;
};

export async function getQuarterCardData(
  companyId: string
): Promise<QuarterCardData> {
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());

  const { data: open } = await supabase
    .from("quarters")
    .select("id, label, start_date, end_date")
    .eq("company_id", companyId)
    .eq("status", "open")
    .maybeSingle<Pick<Quarter, "id" | "label" | "start_date" | "end_date">>();

  // The suggestion follows the LATEST quarter by start date, not the
  // open one. A company that closed Q3 by hand and never opened Q4
  // should still be offered Q4, not the quarter after whatever
  // happens to be open.
  const { data: latest } = await supabase
    .from("quarters")
    .select("start_date, end_date, label")
    .eq("company_id", companyId)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle<Pick<Quarter, "start_date" | "end_date" | "label">>();

  const suggestion = latest
    ? nextCalendarQuarter({
        label: latest.label,
        startDate: latest.start_date,
        endDate: latest.end_date,
      })
    : calendarQuarterOf(new Date());

  // Only what would actually move. 'complete' stays behind, which is
  // the whole rule, so the count has to apply it rather than count
  // every priority in the quarter.
  let carryCount = 0;
  if (open) {
    const { count } = await supabase
      .from("priorities")
      .select("id", { count: "exact", head: true })
      .eq("quarter_id", open.id)
      .neq("status", "complete");
    carryCount = count ?? 0;
  }

  return { openQuarter: open ?? null, suggestion, carryCount };
}
