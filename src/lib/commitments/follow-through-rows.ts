import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { FollowThroughRow } from "./follow-through";

// Where Follow-Through's rows come from, in one place.
//
// follow-through.ts owns the RULE — what counts as a keep, what lands
// in the denominator. This owns the POPULATION, and it exists for the
// same reason: the rule lived in three places once and drifted, so
// B&B Electric read 100%, 62% and "13 for 13" on the same day. The
// population had the identical problem and nobody had noticed.
//
// WHAT WAS MISSING: recurring commitments.
//
// An ongoing commitment is ONE row that never leaves 'open' while the
// cycle runs (migration 0140). Each week's resolution is written to
// commitment_occurrences and the row's due_date rolls forward. So a
// commitment kept faithfully every week for a quarter contributed
// exactly one OPEN row to Follow-Through, and its twelve kept weeks
// contributed nothing at all.
//
// 0140 wrote the rule down when it built the table — "non-ongoing
// resolved commitments contribute one entry each, ongoing rows
// contribute one entry per occurrence" — and then nothing implemented
// it. Not the company_follow_through view, not the Session Brief, not
// Portfolio. `commitment_occurrences` was read by nothing outside the
// resolution path itself.
//
// WHICH WEEKS COUNT, decided by the product owner: the weeks that
// HAPPENED in the window, by their own week_ending. A recurring
// commitment that started last quarter and is still running
// contributes the weeks that fell inside this quarter, not its whole
// history. That is what people mean by "how did we do this quarter".

// An occurrence carries no due_date, and that is correct rather than
// a gap. due_date only decides whether an OPEN row is overdue, and an
// occurrence is a week that has already been resolved.
export type OccurrenceRow = { status: string };

// The pure half, so the merge is testable without a database.
export function mergeFollowThroughRows(
  commitments: readonly FollowThroughRow[],
  occurrences: readonly OccurrenceRow[]
): FollowThroughRow[] {
  return [
    ...commitments,
    ...occurrences.map((o) => ({ status: o.status, due_date: null })),
  ];
}

// Every commitment and every resolved week in the window, for one
// company.
//
// The two halves are filtered on the SAME field name for the same
// reason: `week_ending` is which week the thing belongs to, on both
// tables. A commitment's rolls forward while it is ongoing, so an
// active recurring commitment sits in the current week and its past
// weeks sit where they happened.
export async function loadFollowThroughRows(
  supabase: SupabaseClient,
  companyId: string,
  window: { from: string; to: string }
): Promise<FollowThroughRow[]> {
  const [commitmentsRes, occurrencesRes] = await Promise.all([
    supabase
      .from("commitments")
      .select("status, due_date")
      .eq("company_id", companyId)
      .gte("week_ending", window.from)
      .lte("week_ending", window.to)
      .is("deleted_at", null)
      .is("parked_at", null),
    // Scoped to the company through the parent, since occurrences
    // carry no company_id of their own — deliberately, so a delete on
    // the parent takes them with it. The parent's deleted/parked
    // filters are applied through the same embed, so a parked
    // commitment's history stops counting exactly as the commitment
    // itself does.
    supabase
      .from("commitment_occurrences")
      .select("status, week_ending, commitments!inner(company_id, deleted_at, parked_at)")
      .eq("commitments.company_id", companyId)
      .is("commitments.deleted_at", null)
      .is("commitments.parked_at", null)
      .gte("week_ending", window.from)
      .lte("week_ending", window.to),
  ]);

  return mergeFollowThroughRows(
    (commitmentsRes.data ?? []) as FollowThroughRow[],
    (occurrencesRes.data ?? []) as OccurrenceRow[]
  );
}
