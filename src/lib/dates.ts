// Timezone-aware date helpers for the weekly rhythm.
//
// Convention (Section 8.4): weeks end Friday. "This Friday" is the
// next Friday >= today (in the company's timezone), including today
// when today is Friday. "Last Friday" is thisFriday - 7 days.

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export type YMD = string; // "YYYY-MM-DD"

export function todayInTimezone(timezone: string): {
  iso: YMD;
  weekday: number; // 0=Sun, 6=Sat
} {
  const now = new Date();
  // "en-CA" locale renders YYYY-MM-DD; extracting parts avoids TZ drift.
  const iso = now.toLocaleDateString("en-CA", { timeZone: timezone });
  const weekdayStr = now.toLocaleDateString("en-US", {
    timeZone: timezone,
    weekday: "short",
  }) as (typeof WEEKDAYS)[number];
  const weekday = WEEKDAYS.indexOf(weekdayStr);
  return { iso, weekday };
}

export function addDays(iso: YMD, days: number): YMD {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function thisFriday(timezone: string): YMD {
  const { iso, weekday } = todayInTimezone(timezone);
  // Days until Friday (5). If today is Friday, this returns today.
  const daysUntil = (5 - weekday + 7) % 7;
  return addDays(iso, daysUntil);
}

// The Friday of the week containing iso (weeks end Friday). If iso is
// already a Friday, returns iso. Saturday rolls forward to the next
// Friday. Used to bucket free-form due dates into weekly groups.
export function fridayOf(iso: YMD): YMD {
  const weekday = new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0=Sun … 6=Sat
  const daysUntil = (5 - weekday + 7) % 7;
  return addDays(iso, daysUntil);
}

export function lastFriday(timezone: string): YMD {
  return addDays(thisFriday(timezone), -7);
}

// THE MONDAY THAT OPENS THE WEEK ENDING ON THIS FRIDAY.
//
// Weeks are stored by the Friday they end on and always will be:
// every entry, every target's effective_from, the Saturday sweep and
// the Friday nudge are keyed to it, and Monday is Friday minus four,
// so the two carry identical information.
//
// What changed on 2026-09-19 is which one people READ. "Week ending
// Sep 18" and "week beginning Sep 14" are the same week; the second
// is the one the business thinks in, so it is the one on screen.
// Nothing below this line is a storage concern.
export function mondayOf(weekEndingFriday: YMD): YMD {
  return addDays(weekEndingFriday, -4);
}

// "week beginning Sep 14", from the Friday it is stored under.
export function formatWeekBeginning(weekEndingFriday: YMD): string {
  return formatShortDate(mondayOf(weekEndingFriday));
}

// Compact human range for the header: "Aug 25 – Aug 29"
export function formatWeekRange(weekEnding: YMD): string {
  const start = addDays(weekEnding, -6); // Saturday of prior week … Friday
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${weekEnding}T00:00:00Z`);
  const startStr = startDate.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const endStr = endDate.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return `${startStr} – ${endStr}`;
}

export function formatShortDate(iso: YMD): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
