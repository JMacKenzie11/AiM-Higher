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

export function lastFriday(timezone: string): YMD {
  return addDays(thisFriday(timezone), -7);
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
