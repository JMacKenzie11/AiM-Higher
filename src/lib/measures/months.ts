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

// WEEK 1, WEEK 2 … rather than the Monday's date (Jason, 2026-10-05).
// A date in the column reads as "log it on the 7th"; a week number
// leaves the day to the team. Counted from the week's Monday, so the
// first Monday of a month is Week 1 and a month has four or five.
// From the date rather than the column's position, because the grid
// can open partway into its first month.
export function weekOfMonth(weekEnding: string): number {
  return Math.ceil(Number(mondayOf(weekEnding).slice(8)) / 7);
}

const FULL_MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// "Week 5 of September": a week named the way its column is, for the
// sentences about it (Jason, 2026-10-06). The count beside Save said
// "the week beginning Sep 28" under a grid that calls the same week
// September's Week 5. The month is the one the week begins in, as for
// the column (monthKeyOf).
export function weekLabel(weekEnding: string): string {
  const month = Number(monthKeyOf(weekEnding).slice(5, 7));
  return `Week ${weekOfMonth(weekEnding)} of ${FULL_MONTH_NAMES[month - 1]}`;
}

// "October Week 1": the Pull now list's name for a week (Jason,
// 2026-10-06), in place of its Friday's date. Same week and month as
// the grid's columns.
export function monthWeekLabel(weekEnding: string): string {
  const month = Number(monthKeyOf(weekEnding).slice(5, 7));
  return `${FULL_MONTH_NAMES[month - 1]} Week ${weekOfMonth(weekEnding)}`;
}
