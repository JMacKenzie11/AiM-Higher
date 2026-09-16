import { describe, it, expect } from "vitest";
import {
  goalAnchorId,
  planHrefForGoal,
  planHrefForSfa,
  sfaAnchorId,
} from "./cascade-anchor";

// The point of this module is that the two sides agree, so that is
// what these assert: the href a back link renders ends in exactly
// the id the cascade puts on the row.

describe("cascade anchors", () => {
  it("builds a plan href whose fragment is the row's id", () => {
    const goalId = "0c2f0a8e-1111-4444-8888-aaaaaaaaaaaa";
    expect(planHrefForGoal(goalId)).toBe(`/plan#${goalAnchorId(goalId)}`);

    const sfaId = "7b1d9f22-2222-4444-8888-bbbbbbbbbbbb";
    expect(planHrefForSfa(sfaId)).toBe(`/plan#${sfaAnchorId(sfaId)}`);
  });

  it("keeps the two levels in separate namespaces", () => {
    // A goal and a focus area can never collide on the same id even
    // if they somehow shared a uuid.
    const id = "same-id";
    expect(goalAnchorId(id)).not.toBe(sfaAnchorId(id));
  });

  it("points at /plan, not at the detail page it came from", () => {
    expect(planHrefForGoal("g1").startsWith("/plan#")).toBe(true);
    expect(planHrefForSfa("s1").startsWith("/plan#")).toBe(true);
  });
});
