import { describe, expect, it } from "vitest";
import { AIMS_WEEKLY_SECTIONS } from "@/lib/leadership/facilitation/score";
import { MEETING_STEPS, stepAfter, stepBefore } from "./steps";

describe("meeting steps", () => {
  it("walks the five agenda sections the review scores, then a close", () => {
    expect(MEETING_STEPS).toHaveLength(AIMS_WEEKLY_SECTIONS.length + 1);
    expect(MEETING_STEPS.at(-1)!.key).toBe("close");
  });

  it("steps forward and back, and stops at the ends", () => {
    expect(stepAfter("checkin")).toBe("numbers");
    expect(stepAfter("close")).toBeNull();
    expect(stepBefore("checkin")).toBeNull();
    expect(stepBefore("close")).toBe("commitments");
  });
});
