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

// The quarter that FOLLOWS this one.
//
// CALENDAR-ALIGNED, STAY CALENDAR-ALIGNED. A company whose quarter
// runs 1 Jul to 30 Sep is offered 1 Oct to 31 Dec, exactly as before.
// "The day after, for the same number of days" is NOT the same thing
// at a year boundary: Q4 is 92 days and Q1 is 90, so same-length
// would have offered 1 Jan to 2 April and quietly walked every
// calendar company off the calendar one roll at a time. Caught by a
// test, after that rule had already been written down as safe.
//
// ANYTHING ELSE starts the day after this one ends and runs for the
// same number of days. That is the case the change exists for: now
// that a company can move its end date, snapping back to a calendar
// boundary undoes the edit they just made. Push the end of Q3 out to
// 15 October and the next quarter would still have been offered from
// 1 October, overlapping by a fortnight.
//
// The label comes from the calendar quarter the new start falls in
// either way, because that is what people call it regardless of where
// the company chose to draw its line.
export function quarterAfter(current: CalendarQuarter): CalendarQuarter {
  const calendar = calendarQuarterOf(new Date(`${current.startDate}T00:00:00Z`));
  if (
    calendar.startDate === current.startDate &&
    calendar.endDate === current.endDate
  ) {
    return nextCalendarQuarter(current);
  }

  const start = new Date(`${current.startDate}T00:00:00Z`);
  const end = new Date(`${current.endDate}T00:00:00Z`);
  const days = Math.round((end.getTime() - start.getTime()) / 86400000);

  const nextStart = new Date(end);
  nextStart.setUTCDate(nextStart.getUTCDate() + 1);
  const nextEnd = new Date(nextStart);
  nextEnd.setUTCDate(nextEnd.getUTCDate() + days);

  return {
    label: calendarQuarterOf(nextStart).label,
    startDate: nextStart.toISOString().slice(0, 10),
    endDate: nextEnd.toISOString().slice(0, 10),
  };
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
    ? quarterAfter({
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
