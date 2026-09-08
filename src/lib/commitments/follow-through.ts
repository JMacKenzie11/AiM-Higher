// One definition of Follow-Through Rate for the whole product.
//
// Written 2026-09-04 after B&B Electric showed three different
// numbers for the same thing on the same day: 100% on the companies
// list, 62% on their dashboard, and "13 for 13" in the generated
// brief. None of them were lying. They were each counting a different
// set of commitments, because the rule lived in three places and had
// drifted.
//
// What counts, decided with Jason on 2026-09-04:
//
//   kept_on_time            numerator and denominator
//   kept_late               denominator only — the work landed, but
//                           late, so it should not flatter the rate
//   missed                  denominator only
//   open AND past due       denominator only. This is the change:
//                           previously an overdue open commitment was
//                           invisible here, so a company could be
//                           weeks behind on everything and still show
//                           a perfect rate.
//   open AND not yet due    excluded entirely. Not late yet, so it is
//                           neither a success nor a failure.
//
// Population rules that go with it, enforced by the caller:
//   * operational commitments count. Excluding the ones with no
//     priority flattered companies who do most of their work that way.
//   * issue-linked commitments count.
//   * soft-deleted and parked rows never count. Deleting a commitment
//     used to leave it dragging the rate down.

export type FollowThroughRow = {
  status: string;
  due_date: string | null;
};

export type FollowThroughSummary = {
  keptOnTime: number;
  keptLate: number;
  missed: number;
  // Open, past its due date, and therefore counting against the rate.
  overdueOpen: number;
  // Total rows in the denominator.
  resolved: number;
  // 0-100, or null when there is nothing to judge yet. Null and zero
  // mean very different things and must not be conflated: null is
  // "no data", zero is "nothing landed on time".
  rate: number | null;
};

// The four buckets, already counted. Some callers count rows in Node;
// others have the database do it (see the company_follow_through view,
// migration 0174, which exists so /admin/companies stops shipping
// every commitment on the instance over the wire to count them here).
export type FollowThroughCounts = {
  keptOnTime: number;
  keptLate: number;
  missed: number;
  overdueOpen: number;
};

// The arithmetic, in one place.
//
// summarizeFollowThrough delegates to this, so a caller that arrives
// with counts and a caller that arrives with rows cannot produce
// different numbers. That is the entire point of this file: three
// surfaces once disagreed about the same company on the same day
// because the rule lived in three places.
export function summarizeFollowThroughCounts(
  counts: FollowThroughCounts
): FollowThroughSummary {
  const { keptOnTime, keptLate, missed, overdueOpen } = counts;
  const resolved = keptOnTime + keptLate + missed + overdueOpen;
  return {
    keptOnTime,
    keptLate,
    missed,
    overdueOpen,
    resolved,
    rate: resolved === 0 ? null : Math.round((keptOnTime / resolved) * 100),
  };
}

export function summarizeFollowThrough(
  rows: readonly FollowThroughRow[],
  todayIso: string
): FollowThroughSummary {
  let keptOnTime = 0;
  let keptLate = 0;
  let missed = 0;
  let overdueOpen = 0;

  for (const row of rows) {
    if (row.status === "kept_on_time") keptOnTime += 1;
    else if (row.status === "kept_late") keptLate += 1;
    else if (row.status === "missed") missed += 1;
    else if (row.status === "open") {
      // Strictly past due. A commitment due today is not late today.
      if (row.due_date && row.due_date < todayIso) overdueOpen += 1;
    }
  }

  return summarizeFollowThroughCounts({
    keptOnTime,
    keptLate,
    missed,
    overdueOpen,
  });
}

export function computeFollowThrough(
  rows: readonly FollowThroughRow[],
  todayIso: string
): number | null {
  return summarizeFollowThrough(rows, todayIso).rate;
}

// The column list every caller should select, so the three surfaces
// cannot drift on which fields they read.
export const FOLLOW_THROUGH_COLUMNS = "status, due_date";
