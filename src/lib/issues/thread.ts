// The commitment thread on an issue.
//
// An issue is worked through a SEQUENCE of commitments, not one. The
// database has always allowed that — `commitments.issue_id` is a
// nullable FK with a plain index, and nothing has ever enforced one
// per issue — and `issues/service.ts` has always returned a list. Only
// the card collapsed it, taking `openCommitments[0]` and leaving the
// rest linked but invisible.
//
// This is the derivation that card now reads from. It lives here, pure
// and separate, for one practical reason: the vitest environment is
// `node` with no DOM, so a rendered-component assertion is not
// available. The choice was between testing this by reading JSX with a
// regex and testing it by calling it.
//
// NO NEW STATUS VALUE, AND NO SCHEMA CHANGE. Everything below is
// derived from rows that already exist. "Needs review" in particular
// is a question the data answers, not a column: an issue nobody has
// resolved, with nothing open on it, and at least one thing finished.

import type { CommitmentWithMeta } from "@/lib/commitments/service";

// What counts as finished.
//
// The same three statuses the follow-through rule treats as resolved
// work (lib/commitments/follow-through.ts). `kept_late` belongs here:
// the work landed, and an issue whose commitment landed late is just
// as ready for the "did this solve it?" question as one that landed on
// time. Judging the lateness is follow-through's job, not this one's.
const DONE = new Set(["kept_on_time", "kept_late", "missed"]);

export type IssueThread = {
  // Finished commitments, OLDEST FIRST, so the thread reads downward
  // in the order the work happened.
  completed: CommitmentWithMeta[];
  // The one still in flight. Newest open, matching what the card has
  // always shown in that slot.
  active: CommitmentWithMeta | null;
  // Open commitments beyond the active one. Should be empty in
  // practice — the card only ever offers to add when nothing is open —
  // but a second one is legal in the database, so it is surfaced
  // rather than silently dropped, which is what the old
  // `openCommitments[0]` did.
  otherOpen: CommitmentWithMeta[];
};

function byCreatedAtAsc(a: CommitmentWithMeta, b: CommitmentWithMeta): number {
  return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
}

export function splitThread(
  commitments: readonly CommitmentWithMeta[]
): IssueThread {
  // Soft-deleted and parked rows are not part of the thread, for the
  // same reason they are not part of any count anywhere else in the
  // product. A parked commitment has not been abandoned, but it is not
  // in flight either, and showing it as the current one would be a
  // claim about this week that is not true.
  const live = commitments.filter((c) => !c.deleted_at && !c.parked_at);

  const completed = live.filter((c) => DONE.has(c.status)).sort(byCreatedAtAsc);
  const open = live
    .filter((c) => c.status === "open")
    .sort(byCreatedAtAsc)
    .reverse();

  return {
    completed,
    active: open[0] ?? null,
    otherOpen: open.slice(1),
  };
}

// THE REVIEW MOMENT.
//
// Every commitment on this issue has landed and nobody has said
// whether the issue itself is settled. That is a question for a human,
// and the product's answer is to ask it rather than to guess: nothing
// auto-resolves, nothing auto-creates the next commitment.
//
// All three clauses are load-bearing:
//
//   unresolved        a resolved issue has had its answer
//   nothing open      work still in flight is not a review moment
//   something done    an issue nobody has started is not "reviewed
//                     and awaiting a decision", it is untouched, and
//                     badging it would put a prompt on every empty
//                     issue on the page
//
// The third clause is also what grandfathers the existing data.
// Measured on production 2026-09-14 before this was written: of 27
// issues, 6 were resolved while carrying open commitments and ZERO
// resolved issues had a completed one, so nothing that exists today
// satisfies this. No `resolved_at` cutoff is needed, and adding one
// would be dead code guarding against a population of zero.
export function needsReview(
  issue: { status: string },
  thread: IssueThread
): boolean {
  if (issue.status === "resolved") return false;
  if (thread.active !== null || thread.otherOpen.length > 0) return false;
  return thread.completed.length > 0;
}
