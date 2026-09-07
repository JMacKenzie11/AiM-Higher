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
