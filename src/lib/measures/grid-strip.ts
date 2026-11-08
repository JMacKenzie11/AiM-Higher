import type { GridCellStatus } from "./grid";

// The strip above the /measures grid (Option B, Jason 2026-11-06):
//
//   Last week (Oct 26): 5 of 6 logged
//   This week (Nov 2): 2 of 6 entered
//   On target last week: 4 of 5
//   Show only what needs a number (5)
//
// ---- ONE POPULATION, COUNTED ONCE -----------------------------
//
// Every number here is over the same rows: the measures this caller
// may log (`canLog`), each counted only in a week it is DUE. That is
// the population the old line ("2 of 6 still to log for Week 5 of
// August") counted, the one the Saturday nudge counts, and the one
// the save writes. Two numbers on one page describing one job have
// to count the same things (counts-agree.test.ts), so they are all
// derived here, and numbersToLog (My week) asks this too.
//
// A row is due in a week when its cell says `expected`, which is
// isDueForWeek's answer: a fortnightly measure in its off week, or a
// monthly one outside its month's own week, is not owed and is never
// counted as missing.
//
// ---- WHAT "HAS A VALUE" MEANS IS THE CALLER'S -----------------
//
// The grid asks its live boxes, so a number counts the moment it is
// typed. My week asks what the server holds. The rule for which rows
// and which weeks is the same either way; only the reading differs.
//
// ---- ON TARGET IS THE SERVER'S JUDGEMENT ----------------------
//
// From the cell's own status (cellStatus in grid.ts, judged against
// the target in force that week), not a second comparison here. A
// row with no target, or no value yet, is in neither half of
// "4 of 5": it has not been judged.

export type StripCell = {
  weekEnding: string;
  expected: boolean;
  status: GridCellStatus;
};

export type StripRow = {
  id: string;
  cells: ReadonlyArray<StripCell>;
};

export type StripCounts = {
  // The week that just closed: the one with a deadline. Null on a
  // grid too short to have one, which in practice never ships.
  last: { week: string; due: number; logged: number } | null;
  current: { week: string; due: number; entered: number };
  onTargetLast: { judged: number; good: number } | null;
  // The rows still missing a number in a week that is open to
  // everyone (last week or this week) and in which they are due.
  needsNumber: string[];
};

export function cellAt(row: StripRow, week: string): StripCell | undefined {
  return row.cells.find((c) => c.weekEnding === week);
}

export function isDueIn(row: StripRow, week: string): boolean {
  return cellAt(row, week)?.expected ?? false;
}

export function summarizeStrip<R extends StripRow>(
  // The rows the caller may log. Filtering by canLog is the caller's
  // job because it is a fact about the group, not the row.
  rows: ReadonlyArray<R>,
  {
    lastWeek,
    currentWeek,
    hasValue,
  }: {
    lastWeek: string | null;
    currentWeek: string;
    hasValue: (row: R, week: string) => boolean;
  }
): StripCounts {
  const dueLast = lastWeek ? rows.filter((r) => isDueIn(r, lastWeek)) : [];
  const dueNow = rows.filter((r) => isDueIn(r, currentWeek));

  let judged = 0;
  let good = 0;
  if (lastWeek) {
    for (const r of dueLast) {
      const status = cellAt(r, lastWeek)?.status;
      if (status === "good" || status === "off") judged += 1;
      if (status === "good") good += 1;
    }
  }

  const openWeeks = lastWeek ? [lastWeek, currentWeek] : [currentWeek];
  const needsNumber = rows
    .filter((r) => openWeeks.some((w) => isDueIn(r, w) && !hasValue(r, w)))
    .map((r) => r.id);

  return {
    last: lastWeek
      ? {
          week: lastWeek,
          due: dueLast.length,
          logged: dueLast.filter((r) => hasValue(r, lastWeek)).length,
        }
      : null,
    current: {
      week: currentWeek,
      due: dueNow.length,
      entered: dueNow.filter((r) => hasValue(r, currentWeek)).length,
    },
    onTargetLast: lastWeek ? { judged, good } : null,
    needsNumber,
  };
}
