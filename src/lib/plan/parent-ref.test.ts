import { describe, it, expect } from "vitest";
import {
  formatParentRef,
  parentColumns,
  parentRefOf,
  parseParentRef,
} from "./parent-ref";

// The picker formats, the action parses. If those two disagree the
// screen looks right and the row is wrong, so the round trip is what
// these pin.

describe("parent refs", () => {
  it("round-trips every kind through the wire format", () => {
    const refs = [
      { kind: "goal", id: "8a1f-goal" },
      { kind: "sfa", id: "8a1f-sfa" },
      { kind: "none" },
    ] as const;
    for (const ref of refs) {
      expect(parseParentRef(formatParentRef(ref))).toEqual(ref);
    }
  });

  it("reads a row into a ref", () => {
    expect(parentRefOf({ annual_goal_id: "g1", sfa_id: null })).toEqual({
      kind: "goal",
      id: "g1",
    });
    expect(parentRefOf({ annual_goal_id: null, sfa_id: "s1" })).toEqual({
      kind: "sfa",
      id: "s1",
    });
    expect(parentRefOf({ annual_goal_id: null, sfa_id: null })).toEqual({
      kind: "none",
    });
  });

  it("clears the other column when re-parenting", () => {
    // The whole point. A priority moving from a goal to a focus area
    // must lose the goal in the same write, or it violates
    // `priorities_parent_exclusive` and the save fails with a
    // database error the user cannot act on.
    expect(parentColumns({ kind: "sfa", id: "s1" })).toEqual({
      annual_goal_id: null,
      sfa_id: "s1",
    });
    expect(parentColumns({ kind: "goal", id: "g1" })).toEqual({
      annual_goal_id: "g1",
      sfa_id: null,
    });
    expect(parentColumns({ kind: "none" })).toEqual({
      annual_goal_id: null,
      sfa_id: null,
    });
  });

  it("treats junk as unparented rather than refusing the save", () => {
    // An unlinked priority is a legal, visible state with a picker
    // beside it. A refused save is not.
    for (const junk of ["", null, undefined, "goal:", "wat:1", "::", "goal"]) {
      expect(parseParentRef(junk)).toEqual({ kind: "none" });
    }
  });

  it("keeps a uuid containing a colon intact", () => {
    // Ids are uuids today, so this cannot bite; it is here because
    // splitting on the FIRST colon and rejoining the rest is the
    // difference between an id-shaped assumption and a parser.
    expect(parseParentRef("goal:a:b")).toEqual({ kind: "goal", id: "a:b" });
  });
});
