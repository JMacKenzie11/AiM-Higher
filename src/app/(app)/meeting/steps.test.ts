import { describe, expect, it } from "vitest";
import { CHECK_IN_QUESTIONS, MEETING_STEPS, checkInQuestion, stepAfter, stepBefore } from "./steps";

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

  it("asks the same check-in question all week, and a different one the next", () => {
    // Mon 2026-10-19 to Sun 2026-10-25 is one week.
    const week = ["2026-10-19", "2026-10-21", "2026-10-25"].map(checkInQuestion);
    expect(new Set(week).size).toBe(1);
    expect(checkInQuestion("2026-10-26")).not.toBe(week[0]);
    expect(CHECK_IN_QUESTIONS).toContain(week[0]);
  });
});
