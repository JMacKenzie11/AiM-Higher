import type { GridData } from "./grid";

// How many of this week's numbers a person still has to log: the
// count /measures shows above its grid ("3 of 4 still to log"), for My
// week (simplification review, change 3). The week being chased is the
// one just ended; a measure counts only if it is due that week, in a
// function this person may log for (canLog), and has no value yet.
export function numbersToLog(grid: Pick<GridData, "groups" | "previousWeekEnding" | "currentWeekEnding">): {
  week: string;
  due: number;
  outstanding: number;
} {
  const week = grid.previousWeekEnding ?? grid.currentWeekEnding;
  const due = grid.groups
    .filter((g) => g.canLog)
    .flatMap((g) => g.rows)
    .filter((r) => r.cells.find((c) => c.weekEnding === week)?.expected);
  const outstanding = due.filter((r) => {
    const v = r.cells.find((c) => c.weekEnding === week)?.value;
    return !v || (v.number === null && !v.text);
  }).length;
  return { week, due: due.length, outstanding };
}
