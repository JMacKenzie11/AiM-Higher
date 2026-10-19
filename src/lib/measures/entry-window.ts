import type { UpdateFrequency } from "@/lib/types";
import { addDays, fridayOf } from "@/lib/dates";
import { isDueForWeek, storageWeekFor } from "./frequency";
import { monthKeyOf } from "./months";
import { simplifyOn } from "@/lib/ui/simplify";

// WHICH WEEKS A MEASURE VALUE MAY BE ENTERED FOR. One rule, read by the
// /measures grid to decide which boxes are open and by the server
// before any value is written (measures/entries.ts), so a request that
// never went through the grid meets the same rule. Until 2026-10-13
// the grid was the only place it lived: the entry action had no week
// check at all, so the window was a disabled input and nothing more.
//
// THE RULE.
//   - Weeks are stored by the Friday they end on, so the week must be
//     one. The grid only ever offers Fridays.
//   - It must be a week the grid draws: the rolling year ending this
//     week, in the company's timezone. Nothing in the future.
//   - A monthly measure's value lands on its month's own week
//     (storageWeekFor), whichever week of the month it was typed in.
//   - Open to everyone: this week and the week that just closed. A
//     monthly measure is open for its whole month, and after month end
//     while its own week is still in that window.
//   - An admin of the company may enter any week the grid draws
//     (decided 2026-09-19: correcting an old number is a keystroke, not
//     a conversation with an engineer). Under the "past-numbers"
//     switch so may everyone else who can log the measure (Jeff and
//     Jason, 2026-10-19): rather than stopping a correction, every
//     change is recorded with who and when (0291).
//   - The measure must be due that week (isDueForWeek): nothing before
//     it existed, a fortnightly one every other week, a monthly one in
//     its month's own week.

// How far back /measures scrolls: a rolling twelve months of Fridays,
// current week included. Here rather than in spine.ts, which is
// server-only, because the grid reads it too; spine.ts re-exports it.
//
// 52 rather than 26, decided once the grid existed. Six months shows
// a season; a year shows the same season last year, which is the
// comparison most of these numbers are actually read for. The window
// rolls with today rather than resetting in January, so it never has
// a thin week in the first days of a year.
//
// It is a window, not paging. Everything on file across the fleet
// today sits inside it, and the company that outgrows a year wants a
// different surface rather than a longer table.
export const GRID_WEEKS = 52;

export type EntryWeekArgs = {
  frequency: UpdateFrequency;
  // The week typed into, or its storage week: both resolve the same.
  week: string;
  // This week's Friday in the company's timezone (thisFriday).
  currentWeek: string;
  isAdmin: boolean;
};

export type EntryWeekCheck =
  | { ok: true; storageWeek: string }
  | { ok: false; message: string };

// The weeks open to everyone, oldest first: the week that just closed
// and this one.
export function openWeeks(currentWeek: string): string[] {
  return [addDays(currentWeek, -7), currentWeek];
}

// The oldest week the grid draws.
export function earliestEntryWeek(currentWeek: string): string {
  return addDays(currentWeek, -7 * (GRID_WEEKS - 1));
}

function isFriday(week: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(week) && fridayOf(week) === week;
}

// Is this week open for entry? The grid's question for a box, before
// whether the measure is due there.
// Whether this person gets the admin's window: any week the grid draws.
export function anyWeekOpen(isAdmin: boolean): boolean {
  return isAdmin || simplifyOn("past-numbers");
}

export function isEntryWeekOpen(args: EntryWeekArgs): boolean {
  const { frequency, week, currentWeek } = args;
  const isAdmin = anyWeekOpen(args.isAdmin);
  if (!isFriday(week)) return false;
  const storage = storageWeekFor(frequency, week);
  const earliest = earliestEntryWeek(currentWeek);
  if (frequency === "monthly") {
    const month = monthKeyOf(storage);
    if (month > monthKeyOf(currentWeek) || month < monthKeyOf(earliest)) return false;
    if (isAdmin) return true;
    return month === monthKeyOf(currentWeek) || openWeeks(currentWeek).includes(storage);
  }
  if (week > currentWeek || week < earliest) return false;
  if (isAdmin) return true;
  return openWeeks(currentWeek).includes(week);
}

// The server's question for a value: may it be written, and to which
// week. `createdAt` is the measure's own created_at; nothing is due
// before the measure existed.
export function checkEntryWeek(args: EntryWeekArgs & { createdAt: string }): EntryWeekCheck {
  if (!isFriday(args.week)) {
    return { ok: false, message: "Weeks are recorded by the Friday they end on." };
  }
  if (!isEntryWeekOpen(args)) {
    return {
      ok: false,
      message: anyWeekOpen(args.isAdmin)
        ? "That week is outside the year the measures page shows."
        : "Only this week and last week are open. An admin can change an older week.",
    };
  }
  const storageWeek = storageWeekFor(args.frequency, args.week);
  const due = isDueForWeek({
    frequency: args.frequency,
    weekEndingFriday: storageWeek,
    anchorFriday: fridayOf(args.createdAt.slice(0, 10)),
  });
  if (!due) {
    return { ok: false, message: "That measure isn't due that week." };
  }
  return { ok: true, storageWeek };
}
