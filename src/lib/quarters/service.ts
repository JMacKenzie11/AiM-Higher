import "server-only";

import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Quarter } from "@/lib/types";

// Read-side helpers for quarters. All calls go through the RLS-scoped
// server client so we can trust the user only sees their own company.

export type QuarterWithCounts = Quarter & { priority_count: number };

export async function getQuartersForCompany(
  companyId: string
): Promise<QuarterWithCounts[]> {
  const supabase = await createSupabaseServerClient();

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
    const supabase = await createSupabaseServerClient();
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

export type CalendarQuarter = {
  label: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
};

function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function calendarQuarterOf(date: Date): CalendarQuarter {
  const year = date.getUTCFullYear();
  const q = Math.floor(date.getUTCMonth() / 3) + 1; // 1-4
  const startMonth = (q - 1) * 3;
  const start = new Date(Date.UTC(year, startMonth, 1));
  const end = new Date(Date.UTC(year, startMonth + 3, 0)); // last day of month
  return {
    label: `Q${q} ${year}`,
    startDate: toISODate(start),
    endDate: toISODate(end),
  };
}

export function nextCalendarQuarter(after: CalendarQuarter): CalendarQuarter {
  const end = new Date(`${after.endDate}T00:00:00Z`);
  const dayAfter = new Date(end);
  dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
  return calendarQuarterOf(dayAfter);
}
