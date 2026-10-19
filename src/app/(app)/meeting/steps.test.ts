import { describe, expect, it } from "vitest";
import { MEETING_STEPS, stepAfter, stepBefore } from "./steps";

describe("meeting steps", () => {
  it("runs the agenda Jeff described, then a close", () => {
    expect(MEETING_STEPS.map((s) => s.key)).toEqual([
      "checkin",
      "headlines",
      "numbers",
      "strategy",
      "commitments",
      "solve",
      "close",
    ]);
  });

  it("steps forward and back, and stops at the ends", () => {
    expect(stepAfter("checkin")).toBe("headlines");
    expect(stepAfter("commitments")).toBe("solve");
    expect(stepAfter("close")).toBeNull();
    expect(stepBefore("checkin")).toBeNull();
    expect(stepBefore("close")).toBe("solve");
  });
});
