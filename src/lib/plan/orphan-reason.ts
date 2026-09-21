// Why a row is sitting in the standalone section.
//
// /plan buckets a row as standalone for either of two reasons, and
// they are not the same thing to the person reading it:
//
//   nothing was ever set     — added with no parent, on purpose or
//                              because the parent did not exist yet
//   the parent was archived  — it HAD a home and the home was filed
//
// `bucketCascadeChildren` collapses both into orphanPriorities,
// which is right for layout and wrong for the reader: the second case
// looks identical to the first, so a priority that lost its goal in a
// planning-cycle reset reads as one somebody never bothered to link.
//
// Nothing extra is queried for this. A row in the standalone bucket
// whose parent column is still SET can only be there because that
// parent is not on the plan — the cascade excludes archived parents
// and nothing else removes one — so the reason is derivable from the
// row itself.

type ParentRefs = {
  annual_goal_id: string | null;
  sfa_id: string | null;
};

export type OrphanReason =
  | { kind: "never_linked" }
  | { kind: "parent_archived"; parent: "goal" | "focus_area" };

export function orphanReason(row: ParentRefs): OrphanReason {
  // Goal first, matching bucketCascadeChildren: the database refuses
  // both columns at once (`priorities_parent_exclusive`), and where
  // the two disagree the goal is the one that decides placement.
  if (row.annual_goal_id) return { kind: "parent_archived", parent: "goal" };
  if (row.sfa_id) return { kind: "parent_archived", parent: "focus_area" };
  return { kind: "never_linked" };
}

// The words on the chip. Short, because it sits beside the status and
// the progress bar and competes with both.
export function orphanReasonLabel(reason: OrphanReason): string | null {
  if (reason.kind === "never_linked") return null;
  return reason.parent === "goal"
    ? "Original goal archived"
    : "Original focus area archived";
}

// The longer version, for a detail page that has room for a sentence
// and a reader who arrived without the surrounding list to explain
// itself.
export function orphanReasonNote(reason: OrphanReason): string | null {
  if (reason.kind === "never_linked") return null;
  const what = reason.parent === "goal" ? "goal" : "focus area";
  return (
    `The ${what} this was under has been archived, so it now sits on ` +
    `its own. Link it to a current ${what === "goal" ? "goal or focus area" : "focus area"} and this note goes away.`
  );
}
