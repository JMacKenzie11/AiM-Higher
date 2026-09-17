import { addDays, thisFriday, todayInTimezone } from "@/lib/dates";
import { PULL_DAYS, type ExternalMapping, type PullDay } from "./mapping";

// When the scheduler pulls, and which week it pulls for.
//
// Pure, because these two questions are the only place the cron can
// be wrong in a way nothing shouts about. A pull that runs on the
// wrong day logs a visible failure. A pull that runs on the right day
// and files the number against the wrong WEEK looks like data.

// The default, and the reason it is Saturday.
//
// Weeks end Friday, so Saturday is the first day on which the week
// just gone is complete and its numbers are final. It is also ahead
// of both things downstream that read entries:
//
//   this cron            Sat 14:00 UTC
//   performance sweep    Sat 15:00 UTC   (turns a missing value into
//                                         a commitment on a person)
//   scorecard snapshot   Sun 07:00 UTC   (counts entries from the
//                                         last 7 days)
//
// The hour in front of the sweep is not a hope: every cron route in
// this app sets maxDuration = 300, so a run cannot exceed five
// minutes and cannot overrun into it.
export const STANDARD_PULL_DAY: PullDay = "sat";

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
// So a mapping set to Monday fills exactly the week a Saturday
// mapping would have filled, two days later, rather than a week the
// Saturday pass had already dealt with.
//
// Not thisFriday, which the manual pull uses. On a Saturday
// thisFriday is six days AHEAD — the week that has just begun, whose
// numbers do not exist yet. A scheduler reading that week would find
// an empty row every time and log a failure every week.
export function targetWeekEnding(timezone: string): string {
  return addDays(thisFriday(timezone), -7);
}

export function isDueToday(
  mapping: ExternalMapping,
  timezone: string
): boolean {
  const { weekday } = todayInTimezone(timezone);
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

// Is today the standard pull day in this company's timezone?
//
// Used for mappings that will not parse: they have no pull_day to
// read, and something has to decide when to attempt and fail them.
export function isStandardPullDayToday(timezone: string): boolean {
  const { weekday } = todayInTimezone(timezone);
  return weekdayKey(weekday) === STANDARD_PULL_DAY;
}
