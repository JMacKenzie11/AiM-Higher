import { addDays, thisFriday, todayInTimezone } from "@/lib/dates";
import { PULL_DAYS, type ExternalMapping, type PullDay } from "./mapping";

// When the scheduler pulls, and which week it pulls for.
//
// Pure, because these two questions are the only place the cron can
// be wrong in a way nothing shouts about. A pull that runs on the
// wrong day logs a visible failure. A pull that runs on the right day
// and files the number against the wrong WEEK looks like data.

// WHEN: 11 PM EASTERN, SUNDAY BY DEFAULT (Jason, 2026-10-06).
//
// It was Saturday at 14:00 UTC. Weeks end Friday, so either day reads
// a complete week; Sunday night is Jason's choice.
//
// ONE CLOCK FOR EVERY COMPANY: Eastern. The day is decided in
// America/New_York, not in each company's timezone, so every company
// is pulled at the same moment. Decided per company, Halifax (an hour
// ahead of New York) would be into Monday at 11 PM Eastern during
// daylight time, and a Sunday pull would skip it.
//
// 11 PM EASTERN ALL YEAR. Vercel's cron runs in UTC and knows nothing
// of daylight saving, so the job wakes at 03:00 and 04:00 UTC every
// day (vercel.json) and does its work only on the run that is 11 PM
// in New York: 03:00 UTC under daylight time, 04:00 UTC under
// standard time. The other run does nothing.
//
// Downstream, everything still comes after:
//
//   this pull            Sun 11 PM Eastern (Mon 03:00/04:00 UTC)
//   scorecard snapshot   Mon 07:00 UTC   (counts entries from the
//                                         last 7 days; moved off
//                                         Sunday with this, or a
//                                         pulled week would never
//                                         count)
//   performance sweep    Tue 12:00 UTC   (turns a missing value into
//                                         a commitment on a person)
//
// The margin is not a hope: every cron route in this app sets
// maxDuration = 300, so a run cannot exceed five minutes.
export const SCHEDULE_TIMEZONE = "America/New_York";
export const PULL_HOUR = 23;
export const STANDARD_PULL_DAY: PullDay = "sun";

// Is it the pull hour in New York? The route asks this first and
// does nothing on the other daily wake-up.
export function isPullHour(now: Date = new Date()): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: SCHEDULE_TIMEZONE,
      hour: "numeric",
      hourCycle: "h23",
    }).format(now)
  );
  return hour === PULL_HOUR;
}

export function weekdayKey(weekday: number): PullDay {
  return PULL_DAYS[weekday] ?? STANDARD_PULL_DAY;
}

export function effectivePullDay(mapping: ExternalMapping): PullDay {
  return mapping.pull_day ?? STANDARD_PULL_DAY;
}

// THE TARGET WEEK IS THE SAME WHICHEVER DAY THE PASS RUNS, and that
// is the property pull_day depends on.
//
// lastFriday is the most recently COMPLETED week, and it gives the
// same answer every day from Saturday through the following Friday.
// So a mapping set to Monday fills exactly the week a Sunday mapping
// would have filled, a day later, rather than a week the Sunday pass
// had already dealt with. Read in the COMPANY's timezone: at 11 PM
// Eastern on a Sunday, every company on the fleet is in Sunday or the
// first hour of Monday, and both give the same week.
//
// Not thisFriday, which the manual pull uses. On a Saturday
// thisFriday is six days AHEAD — the week that has just begun, whose
// numbers do not exist yet. A scheduler reading that week would find
// an empty row every time and log a failure every week.
export function targetWeekEnding(timezone: string): string {
  return addDays(thisFriday(timezone), -7);
}

// Today, in Eastern time (SCHEDULE_TIMEZONE), whatever the company's.
export function isDueToday(mapping: ExternalMapping): boolean {
  const { weekday } = todayInTimezone(SCHEDULE_TIMEZONE);
  return effectivePullDay(mapping) === weekdayKey(weekday);
}

// ---- Transient failures ----------------------------------------
//
// One retry, then the week stays awaiting. The distinction that
// matters: retrying a misspelled tab name a second time produces the
// identical answer a second later and doubles the load on somebody
// else's API for nothing. Retrying a socket hang-up sometimes works.
//
// Matched on the shapes Google and Node actually produce. Anything
// unrecognised is NOT retried, which is the safe direction: an
// unknown failure that would have succeeded on retry costs one week
// of one measure and says so on the receipt, where an unknown
// failure retried in a loop costs a rate limit for every company on
// the instance.
const TRANSIENT =
  /\b(ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|socket hang up|network|timeout|timed out|rate limit|quota exceeded|backend error|internal error|try again|temporarily unavailable)\b|\b(429|500|502|503|504)\b/i;

export function isTransient(message: string): boolean {
  return TRANSIENT.test(message);
}

// Is today the standard pull day, in Eastern time?
//
// Used for mappings that will not parse: they have no pull_day to
// read, and something has to decide when to attempt and fail them.
export function isStandardPullDayToday(): boolean {
  const { weekday } = todayInTimezone(SCHEDULE_TIMEZONE);
  return weekdayKey(weekday) === STANDARD_PULL_DAY;
}
