import type { GridData } from "./grid";
import { summarizeStrip } from "./grid-strip";

// How many of this week's numbers a person still has to log: the
// count /measures shows above its grid as "Last week: 5 of 6 logged",
// for My week (simplification review, change 3). The week being
// chased is the one just ended; a measure counts only if it is due
// that week, in a function this person may log for (canLog), and has
// no value yet.
//
// The rule is the grid strip's (grid-strip.ts), asked of what the
// server holds rather than of the grid's live boxes, so the two pages
// cannot count different things.
export function numbersToLog(grid: Pick<GridData, "groups" | "previousWeekEnding" | "currentWeekEnding">): {
  week: string;
  due: number;
  outstanding: number;
} {
  const week = grid.previousWeekEnding ?? grid.currentWeekEnding;
  const rows = grid.groups.filter((g) => g.canLog).flatMap((g) => g.rows);
  const { last } = summarizeStrip(rows, {
    lastWeek: week,
    currentWeek: grid.currentWeekEnding,
    hasValue: (r, w) => {
      const v = r.cells.find((c) => c.weekEnding === w)?.value;
      return !!v && (v.number !== null || !!v.text);
    },
  });
  const due = last?.due ?? 0;
  return { week, due, outstanding: due - (last?.logged ?? 0) };
}
