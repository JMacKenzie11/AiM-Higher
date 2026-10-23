import { describe, expect, it } from "vitest";
import { CHECK_IN_QUESTIONS, MEETING_STEPS, checkInQuestions, stepAfter, stepBefore } from "./steps";

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

  it("suggests the same two check-in questions all week, and a different two the next", () => {
    // Mon 2026-10-19 to Sun 2026-10-25 is one week.
    const week = ["2026-10-19", "2026-10-21", "2026-10-25"].map((d) => checkInQuestions(d).join("|"));
    expect(new Set(week).size).toBe(1);
    const [a, b] = checkInQuestions("2026-10-19");
    expect(a).not.toBe(b);
    const next = checkInQuestions("2026-10-26");
    expect(next).not.toContain(a);
    expect(next).not.toContain(b);
  });

  it("goes six weeks before a question comes back", () => {
    const mondays = Array.from({ length: 6 }, (_, i) => new Date(Date.UTC(2026, 9, 19 + i * 7)).toISOString().slice(0, 10));
    const asked = mondays.flatMap(checkInQuestions);
    expect(new Set(asked).size).toBe(12);
    expect(new Set(asked)).toEqual(new Set(CHECK_IN_QUESTIONS));
    expect(checkInQuestions("2026-11-30")).toEqual(checkInQuestions("2026-10-19"));
  });
});
