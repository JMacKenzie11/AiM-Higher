import { describe, it, expect } from "vitest";
import { resolveDuePhrase, meetingDateIn } from "./due-phrase";

// The meeting that produced these rules: Benson Seafood,
// Tuesday 22 September 2026, recorded 16:15 UTC, America/Halifax.
const MEETING = "2026-09-22";

describe("resolveDuePhrase", () => {
  it("keeps tonight on the night it was said", () => {
    // THE BUG. Casey said "I'm going to do it tonight" and the model
    // resolved it to that Friday — three days of drift on a
    // commitment somebody made for the same evening.
    expect(resolveDuePhrase("tonight", MEETING)).toBe("2026-09-22");
    expect(resolveDuePhrase("later today", MEETING)).toBe("2026-09-22");
    expect(resolveDuePhrase("this morning", MEETING)).toBe("2026-09-22");
  });

  it("resolves this week to that week's Friday, every time", () => {
    // THE OTHER BUG. The same phrase gave Friday the 25th on one run
    // and Saturday the 26th on the next, from an identical
    // transcript. Arithmetic is not a judgement call.
    for (let i = 0; i < 5; i++) {
      expect(resolveDuePhrase("by the end of this week", MEETING)).toBe("2026-09-25");
    }
  });

  it("resolves end of the month to the real last day", () => {
    expect(resolveDuePhrase("by end of the month", MEETING)).toBe("2026-09-30");
    // February, and a leap year, because a month is not 30 days.
    expect(resolveDuePhrase("end of the month", "2028-02-03")).toBe("2028-02-29");
  });

  it("takes a named weekday forward, never backward", () => {
    // Meeting is a Tuesday.
    expect(resolveDuePhrase("by Thursday", MEETING)).toBe("2026-09-24");
    // Monday is next week's, not yesterday's.
    expect(resolveDuePhrase("Monday", MEETING)).toBe("2026-09-28");
  });

  it("says nothing when the phrase says nothing", () => {
    // "Soon" is not a deadline. Inventing one gives a team a date
    // nobody agreed and a red row when it passes.
    for (const vague of ["soon", "in the next few weeks", "when I get a chance", "at some point"]) {
      expect(resolveDuePhrase(vague, MEETING)).toBeNull();
    }
    expect(resolveDuePhrase(null, MEETING)).toBeNull();
  });

  it("handles a Friday meeting saying this week", () => {
    // The edge that a naive "+ days until Friday" gets wrong by a
    // week: on a Friday, this week is today.
    expect(resolveDuePhrase("end of the week", "2026-09-25")).toBe("2026-09-25");
  });
});

describe("meetingDateIn", () => {
  it("uses the company's day, not the server's", () => {
    // Benson: 16:15 UTC is 13:15 in Halifax — the same day.
    expect(meetingDateIn("2026-09-22T16:15:21.850731+00:00", "America/Halifax"))
      .toBe("2026-09-22");
  });

  it("does not roll an evening meeting into tomorrow", () => {
    // An evening meeting on the west coast is already the next day
    // in UTC. Resolving "tonight" against the UTC date would put
    // every same-day commitment a day early for the whole team.
    expect(meetingDateIn("2026-09-23T02:30:00.000Z", "America/Vancouver"))
      .toBe("2026-09-22");
  });
});
