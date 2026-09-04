import type { UpdateFrequency } from "@/lib/types";
import { addDays } from "@/lib/dates";

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

// Is a value expected for the week ending on this Friday?
//
// Anchored to the measure's first expected week rather than to the
// calendar, so a fortnightly measure keeps its own rhythm instead of
// jumping when a month has five Fridays. anchorFriday is normally the
// Friday of the week the measure was created.
export function isDueForWeek(args: {
  frequency: UpdateFrequency;
  weekEndingFriday: string;
  anchorFriday: string;
}): boolean {
  const { frequency, weekEndingFriday, anchorFriday } = args;
  if (frequency === "weekly") return true;
  if (weekEndingFriday < anchorFriday) return false;

  const weeksApart = Math.round(
    (Date.parse(`${weekEndingFriday}T00:00:00Z`) -
      Date.parse(`${anchorFriday}T00:00:00Z`)) /
      (7 * 24 * 60 * 60 * 1000)
  );
  if (frequency === "biweekly") return weeksApart % 2 === 0;
  // Monthly: expected on the anchor week and roughly every fourth
  // week after it. Four weeks rather than a calendar month keeps the
  // rhythm on Fridays, which is what every surface renders.
  return weeksApart % 4 === 0;
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
  // A fortnightly measure is at most one week off an expected Friday,
  // a monthly one at most three, so this walks back four at the most.
  for (let i = 0; i < 4; i += 1) {
    if (isDueForWeek({ frequency, weekEndingFriday: candidate, anchorFriday })) {
      return candidate;
    }
    candidate = addDays(candidate, -7);
    if (candidate < anchorFriday) return null;
  }
  return null;
}
