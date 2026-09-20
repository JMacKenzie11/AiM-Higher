import type { UpdateFrequency } from "@/lib/types";
import { addDays, mondayOf } from "@/lib/dates";

// One definition of what an update frequency means, so the cron, the
// board and the Success Tracking scorer cannot disagree about whether
// a measure is due.
//
// Weekly was assumed in four separate places before this. A monthly
// measure looked permanently delinquent to all of them: nagged every
// Friday, shown empty for three cells in four, and scored as missed
// cadence every week.
//
// Values always land on a Friday. Frequency changes which Fridays are
// EXPECTED, never how a value is stored, so the (measure, week_ending)
// key and every existing entry stay valid.

export const FREQUENCY_LABELS: Record<UpdateFrequency, string> = {
  weekly: "Every week",
  biweekly: "Every two weeks",
  monthly: "Every month",
};

// How many days back a value is still considered current for this
// frequency. Used by the cadence half of the Success Tracking score,
// which previously asked "logged in the last 7 days" of everything.
export function freshnessWindowDays(frequency: UpdateFrequency): number {
  if (frequency === "monthly") return 31;
  if (frequency === "biweekly") return 14;
  return 7;
}

// The last Friday of the calendar month this Friday falls in.
//
// A month has four or five Fridays and the last is the one whose
// following Friday has crossed into the next month. Exact, and it
// needs no calendar arithmetic beyond a string compare, because a
// week is filed by the month its Friday ends in and the grid groups
// weeks the same way. The two cannot drift.
// The LAST WEEK OF A MONTH, by the month the week BEGINS in.
//
// It used to compare the Fridays, which was the same question while
// the page said "week ending". /measures now labels a column with its
// Monday and groups the months the same way, so this had to move with
// it: a monthly measure is due in its month's last week, and "last
// week of September" has to mean the same thing in the column header
// and in the due date, or the page chases a number in a month whose
// heading it is not under.
//
// WHAT THIS CHANGES IN PRACTICE. Around five weeks a year straddle a
// month boundary. For those, a monthly measure's due week moves by
// one: September 2026 closes on the week beginning Mon 28 Sep (ending
// Fri 2 Oct) rather than the one ending Fri 25 Sep. The Saturday
// sweep and the Friday nudge both read this, so they move with it —
// deliberately, so all three agree.
//
// The name keeps "Friday" because the argument still is one: weeks
// are stored by the Friday they end on and always will be.
export function isLastFridayOfMonth(friday: string): boolean {
  return (
    mondayOf(friday).slice(0, 7) !== mondayOf(addDays(friday, 7)).slice(0, 7)
  );
}

// Is a value expected for the week ending on this Friday?
//
// MONTHLY MEANS THE MONTH'S LAST WEEK, by product decision. It used
// to mean "every fourth Friday from the one the measure was created
// in", which kept the rhythm on Fridays but drifted away from the
// calendar: a measure created mid-September reported in the second
// week of some months and the third week of others, and never
// reliably at month end. For a number that closes with the month,
// which is what monthly measures are, that is the wrong week.
//
// FORTNIGHTLY STAYS ANCHORED. There is no calendar equivalent of
// "every two weeks", and the anchor rhythm is the right answer for
// it. Only monthly changed.
//
// anchorFriday is normally the Friday of the week the measure was
// created. It still bounds both: nothing is expected before the
// measure existed.
export function isDueForWeek(args: {
  frequency: UpdateFrequency;
  weekEndingFriday: string;
  anchorFriday: string;
}): boolean {
  const { frequency, weekEndingFriday, anchorFriday } = args;
  if (frequency === "weekly") return true;
  if (weekEndingFriday < anchorFriday) return false;
  if (frequency === "monthly") return isLastFridayOfMonth(weekEndingFriday);

  const weeksApart = Math.round(
    (Date.parse(`${weekEndingFriday}T00:00:00Z`) -
      Date.parse(`${anchorFriday}T00:00:00Z`)) /
      (7 * 24 * 60 * 60 * 1000)
  );
  return weeksApart % 2 === 0;
}

// The Fridays a measure is expected to report on, within a window.
// The board uses this to grey out cells that were never expected,
// instead of showing them as missed.
export function expectedFridaysIn(args: {
  frequency: UpdateFrequency;
  fridays: readonly string[];
  anchorFriday: string;
}): Set<string> {
  return new Set(
    args.fridays.filter((f) =>
      isDueForWeek({
        frequency: args.frequency,
        weekEndingFriday: f,
        anchorFriday: args.anchorFriday,
      })
    )
  );
}

// The most recent Friday on or before `weekEnding` that this measure
// was expected to report on. The cron uses it to ask "did they log
// the period that just closed" rather than "did they log this week".
export function lastExpectedFriday(args: {
  frequency: UpdateFrequency;
  weekEndingFriday: string;
  anchorFriday: string;
}): string | null {
  const { frequency, weekEndingFriday, anchorFriday } = args;
  if (frequency === "weekly") return weekEndingFriday;
  if (weekEndingFriday < anchorFriday) return null;

  let candidate = weekEndingFriday;
  // A fortnightly measure is at most one week off an expected Friday.
  // A monthly one is at most four, which happens on the fourth Friday
  // of a five-Friday month: the month's own last Friday is still
  // ahead, so the nearest behind is the previous month's.
  for (let i = 0; i < 5; i += 1) {
    if (isDueForWeek({ frequency, weekEndingFriday: candidate, anchorFriday })) {
      return candidate;
    }
    candidate = addDays(candidate, -7);
    if (candidate < anchorFriday) return null;
  }
  return null;
}

// WHICH WEEK A VALUE ACTUALLY LANDS ON.
//
// For a weekly or fortnightly measure this is the week you are
// looking at, and always was.
//
// For a MONTHLY one it is the month's own week — the last week
// beginning in that month — whichever week you typed into. That is
// the whole of the "enter it whenever" change: the grid offers a box
// in every week of the month, and they all read and write one value.
//
// STORAGE DOES NOT MOVE, which is the point. The Tuesday sweep asks
// whether the month's week has a value, the dashboard board plots it
// there, and the target history judges it there — none of them needs
// to know a box appeared in week one. A value typed on the 3rd is
// already sitting in the right place when the sweep looks.
//
// The walk terminates in at most five steps: every week belongs to
// exactly one month by its Monday, and every month has a last one.
export function storageWeekFor(
  frequency: UpdateFrequency,
  weekEndingFriday: string
): string {
  if (frequency !== "monthly") return weekEndingFriday;
  let week = weekEndingFriday;
  for (let i = 0; i < 6 && !isLastFridayOfMonth(week); i += 1) {
    week = addDays(week, 7);
  }
  return week;
}
