// What a quarterly priority hangs off.
//
// A priority has ONE parent or none: a goal, a focus area, or
// nothing at all (the "Standalone" section on /plan). The database
// enforces that with `priorities_parent_exclusive`; this module is
// how the rest of the app reads and writes it without every caller
// re-deriving "goal id set, else sfa id set, else neither".
//
// The wire format exists because a <select> submits ONE value and
// the picker offers both levels in one list. A round-trip through
// `formatParentRef` / `parseParentRef` is lossless, which is what
// the tests pin: a picker that formats one way and an action that
// parses another is invisible on screen and wrong in the database.

export type ParentRef =
  | { kind: "goal"; id: string }
  | { kind: "sfa"; id: string }
  | { kind: "none" };

export const NO_PARENT = "";

// Row → ref. Goal wins if both are somehow set, which the CHECK
// constraint makes impossible in the database and which a stale
// in-memory object could still carry.
export function parentRefOf(row: {
  annual_goal_id: string | null;
  sfa_id: string | null;
}): ParentRef {
  if (row.annual_goal_id) return { kind: "goal", id: row.annual_goal_id };
  if (row.sfa_id) return { kind: "sfa", id: row.sfa_id };
  return { kind: "none" };
}

// Ref → the value a <select> option carries.
export function formatParentRef(ref: ParentRef): string {
  if (ref.kind === "none") return NO_PARENT;
  return `${ref.kind}:${ref.id}`;
}

// Form value → ref. Anything unrecognised is "none" rather than an
// error: a priority with no parent is a legal, visible state, so the
// failure mode of a garbled value is an unlinked row the user can
// see and fix, not a refused save.
export function parseParentRef(value: string | null | undefined): ParentRef {
  if (!value) return { kind: "none" };
  const [kind, ...rest] = value.split(":");
  const id = rest.join(":").trim();
  if (!id) return { kind: "none" };
  if (kind === "goal") return { kind: "goal", id };
  if (kind === "sfa") return { kind: "sfa", id };
  return { kind: "none" };
}

// Ref → the two columns. Always writes BOTH, so re-parenting clears
// the side it is moving away from. Writing only the new one is the
// bug this function exists to prevent: the row would keep its old
// parent, fail the exclusivity CHECK, and the save would look like
// an unexplained database error.
export function parentColumns(ref: ParentRef): {
  annual_goal_id: string | null;
  sfa_id: string | null;
} {
  return {
    annual_goal_id: ref.kind === "goal" ? ref.id : null,
    sfa_id: ref.kind === "sfa" ? ref.id : null,
  };
}
