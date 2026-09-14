// How healthy is a quarter's set of priorities?
//
// EXTRACTED, NOT WRITTEN. This arithmetic lived inline in
// getDashboardData as two lines, and /portfolio needs the same answer
// per company. Copying two lines is exactly how Follow-Through Rate
// came to mean three different things on the same day (see
// lib/commitments/follow-through.ts, written after B&B Electric showed
// 100%, 62% and "13 for 13" for one company on one afternoon). Two
// lines is a small enough amount of code that copying it feels free,
// which is what makes it worth moving.
//
// WHAT COUNTS AS GOOD. `on_track` and `complete`. Not `at_risk`, not
// `off_track`, and `complete` counts because a finished priority is
// the best possible state rather than an absent one. That rule is the
// thing this file exists to keep in one place.
//
// ARCHIVED ROWS ARE THE CALLER'S PROBLEM. Both callers filter them out
// in the query, which is where it belongs: an archived priority should
// not be fetched, never mind counted.

export type PriorityHealthRow = {
  status: string;
};

export type PriorityHealth = {
  // Priorities in a good state.
  good: number;
  // Every priority in the quarter.
  total: number;
  // 0-100, or null when the quarter has no priorities yet.
  //
  // Null and zero mean very different things and must not be
  // conflated, the same rule follow-through follows: null is "nothing
  // planned yet", zero is "nothing is on track". On a portfolio
  // overview those two render differently and should.
  percent: number | null;
};

export function summarizePriorityHealth(
  rows: readonly PriorityHealthRow[]
): PriorityHealth {
  const total = rows.length;
  const good = rows.filter(
    (p) => p.status === "on_track" || p.status === "complete"
  ).length;
  return {
    good,
    total,
    percent: total === 0 ? null : Math.round((good / total) * 100),
  };
}
