import { describe, it, expect } from "vitest";
import {
  orphanReason,
  orphanReasonLabel,
  orphanReasonNote,
} from "./orphan-reason";

// Both ways a row lands in the standalone section, told apart.
//
// The distinction is the whole point: "nobody linked this" and "the
// goal this was under got archived" look identical on /plan, and the
// second is not the reader's fault or their job to fix the same way.

describe("orphanReason", () => {
  it("calls a row with no parent columns never linked", () => {
    expect(orphanReason({ annual_goal_id: null, sfa_id: null })).toEqual({
      kind: "never_linked",
    });
  });

  it("reads a set goal id, on a standalone row, as an archived goal", () => {
    // A priority only reaches the standalone bucket when its parent
    // is not on the plan, and the only thing that takes a parent off
    // the plan is archiving it.
    expect(orphanReason({ annual_goal_id: "g1", sfa_id: null })).toEqual({
      kind: "parent_archived",
      parent: "goal",
    });
  });

  it("reads a set sfa id the same way", () => {
    expect(orphanReason({ annual_goal_id: null, sfa_id: "s1" })).toEqual({
      kind: "parent_archived",
      parent: "focus_area",
    });
  });

  it("lets the goal decide when both are somehow set", () => {
    // The database refuses that pair, and bucketCascadeChildren
    // checks the goal first. Disagreeing here would label a row for a
    // parent it is not bucketed under.
    expect(orphanReason({ annual_goal_id: "g1", sfa_id: "s1" })).toEqual({
      kind: "parent_archived",
      parent: "goal",
    });
  });
});

describe("the wording", () => {
  it("says nothing at all for a row nobody linked", () => {
    // No chip, not an empty chip. A standalone row that was always
    // standalone is not carrying news.
    const r = orphanReason({ annual_goal_id: null, sfa_id: null });
    expect(orphanReasonLabel(r)).toBeNull();
    expect(orphanReasonNote(r)).toBeNull();
  });

  it("names which kind of parent went", () => {
    expect(
      orphanReasonLabel(orphanReason({ annual_goal_id: "g", sfa_id: null }))
    ).toBe("Original goal archived");
    expect(
      orphanReasonLabel(orphanReason({ annual_goal_id: null, sfa_id: "s" }))
    ).toBe("Original focus area archived");
  });

  it("tells the reader how to make it go away", () => {
    const note = orphanReasonNote(
      orphanReason({ annual_goal_id: "g", sfa_id: null })
    )!;
    expect(note).toContain("archived");
    expect(note).toContain("goes away");
  });
});
