import { mondayOf } from "@/lib/dates";

// Which month a week belongs to, and what to call it.
//
// PURE, AND IN ITS OWN FILE for one reason: /measures is a client
// component and grid.ts is not. grid.ts reaches the database, so
// importing a VALUE from it — rather than a type — drags the server
// client into the browser bundle and the build stops with "you're
// importing a component that needs server-only".
//
// Types were always safe because they are erased. These two are
// called at render time, so they had to move.

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// A week belongs to the month its FRIDAY falls in.
//
// Weeks run Saturday to Friday, so one straddles a month boundary
// four or five times a year. Filing it by the end date means a
// monthly measure's reporting week and its month agree, which is the
// whole reason the grouping exists.
// WHICH MONTH A WEEK BELONGS TO — the month it BEGINS in.
//
// It used to be the month it ended in, which was the same question
// while the page said "week ending". Now that a column is labelled
// with its Monday, filing the week beginning Mon 28 Sep under October
// would put a September-looking number under an October heading.
//
// This is the one place the relabelling stops being cosmetic, and it
// moves `isLastFridayOfMonth` with it: a monthly measure is due in
// the month's last week, and "last week" has to mean the same thing
// here and there or the column and the due date disagree.
export function monthKeyOf(weekEnding: string): string {
  return mondayOf(weekEnding).slice(0, 7);
}

export function monthLabel(key: string): string {
  const [year, month] = key.split("-");
  return `${MONTH_NAMES[Number(month) - 1]} ${year}`;
}
