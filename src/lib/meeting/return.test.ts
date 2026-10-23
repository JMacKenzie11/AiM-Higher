import { describe, expect, it } from "vitest";
import { fromMeeting, meetingReturn } from "./return";

describe("the way back to the meeting", () => {
  const step = "/meeting?step=strategy&started=2026-10-23T15%3A00%3A00.000Z";

  it("takes the meeting's own address, from the link that carried it", () => {
    expect(meetingReturn(step)).toBe(step);
    expect(meetingReturn([step, "/elsewhere"])).toBe(step);
    expect(new URLSearchParams(fromMeeting(step)).get("from")).toBe(step);
  });

  it("takes nothing else", () => {
    for (const v of [undefined, "", "/plan", "https://example.com/meeting?x", "//example.com/meeting?", "/meeting", "/meeting?step=x//evil", "/meeting?a\\b", "/meeting? x", `/meeting?${"a".repeat(600)}`]) {
      expect(meetingReturn(v)).toBeNull();
    }
    expect(fromMeeting(null)).toBe("");
  });
});
