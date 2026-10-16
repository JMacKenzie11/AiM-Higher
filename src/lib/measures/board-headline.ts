import type { BoardData } from "./board";

// The board's one-line summary, and the counts behind it. Pure, and
// kept out of board.ts because that file is server-only and the board
// card that renders this is a client component.

export type BoardHeadline = {
  currentGood: number;
  currentOff: number;
  currentUnlogged: number;
  // Measures with a target this week. A measure with no target can be
  // neither on nor off, so it is left out of every count.
  currentEligible: number;
};

export function summarizeBoard(data: BoardData): BoardHeadline {
  let currentGood = 0;
  let currentOff = 0;
  let currentUnlogged = 0;
  let currentEligible = 0;
  const currentIdx = data.weeks.length - 1;
  for (const fn of data.functions) {
    for (const m of fn.metrics) {
      const cell = m.cells[currentIdx];
      if (!cell) continue;
      if (cell.status === "no_target") continue;
      currentEligible += 1;
      if (cell.status === "good") currentGood += 1;
      else if (cell.status === "off") currentOff += 1;
      else if (cell.status === "unlogged") currentUnlogged += 1;
    }
  }
  return { currentGood, currentOff, currentUnlogged, currentEligible };
}

// How many functions have at least one measure off target this week.
// Named functions rather than a count of measures, because "3
// functions off target" is a sentence a leader acts on and "7 of 34
// readings" is one they have to decode.
export function countOffFunctions(data: BoardData): number {
  return data.functions.filter((fn) =>
    fn.metrics.some((m) => m.cells[m.cells.length - 1]?.status === "off")
  ).length;
}

// What the collapsed line says. "Everything on target" is only true
// when there is something to be on target against: with no measure
// carrying a target, a clean week is an empty one, and saying it is
// fine tells a leader all is well when nothing is being checked.
export function boardHeadlineText(
  headline: BoardHeadline,
  offFunctions: number
): string {
  if (offFunctions > 0) {
    return `${offFunctions} function${offFunctions === 1 ? "" : "s"} off target this week`;
  }
  if (headline.currentEligible === 0) return "No targets set yet";
  if (headline.currentUnlogged > 0) {
    return `${headline.currentUnlogged} not logged this week`;
  }
  return "Everything on target this week";
}
