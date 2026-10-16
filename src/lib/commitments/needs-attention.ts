import type { Commitment } from "@/lib/types";

// THE ONE RULE for "Needs attention" on /commitments: still open, and
// from an earlier week than this one.
//
// The header pill and the section it names each had their own copy of
// this, and they disagreed. The pill read `week_ending`, the section
// read `due_date`, and the same screen showed 111 beside 115. The four
// in between were rows due Monday to Thursday of the current week:
// `due_date` was before this Friday, `week_ending` was this Friday.
//
// `week_ending` is the right column. It is the Friday of the week a
// commitment belongs to, the week the meeting reviews it in, and the
// help says Needs attention holds "anything from an earlier week that's
// still open". Reading `due_date` instead put a row due this Thursday
// under "overdue" on the Monday before it, while it was still on time.
// Every row the rule admits is overdue as well: its week ended on a
// Friday before this one, so its due date has passed.
//
// thisFriday is the company's current Friday (`thisFriday(timezone)`).
export function isNeedsAttention(
  c: Pick<Commitment, "status" | "week_ending">,
  thisFriday: string
): boolean {
  return c.status === "open" && c.week_ending < thisFriday;
}
