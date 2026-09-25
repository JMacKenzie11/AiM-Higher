import { describe, it, expect } from "vitest";
import { findHeadlineRepeat, headlineRepeatRetryInstruction } from "./repetition";

// The real pair from the 2026-09-25 fixture run.
const HEADLINE =
  "You traced the Tuesday scheduling conflict past its third repeat and found the real gap: nobody owned the calendar. That's the kind of root-cause instinct that stops a recurring problem cold. Is it worth five minutes to look at what made it work?";

const REPEATING_OPENER = `Third week running for that Tuesday collision, and this time it stopped at "who owns the calendar" instead of another patch. That took someone actually asking what was underneath the pattern instead of just fixing the latest instance.

You were in the room for that one, and also picked up two of your own commitments out of the margin conversation. Before we get to those: what do you think made it possible for the group to name the calendar ownership gap this time, instead of the third time it happened?`;

describe("findHeadlineRepeat", () => {
  it("catches the real opener: same event, same question", () => {
    const hit = findHeadlineRepeat(REPEATING_OPENER, HEADLINE);
    expect(hit).not.toBeNull();
    expect(hit!.sharedEvent).toEqual(
      expect.arrayContaining(["tuesday", "third", "calendar", "own"])
    );
    expect(hit!.sharedQuestion).toContain("(both ask what made it work)");
  });

  // The two openings that run had and did not take. Neither may be
  // sent back, or the check pushes the model away from the right
  // answer.
  it("passes an opener about the champion's own commitments", () => {
    expect(
      findHeadlineRepeat(
        "You took on two things from the margin talk. One is the Q4 model, and one is folding in the Dunleavy credit. Which of those is harder?",
        HEADLINE
      )
    ).toBeNull();
  });

  it("passes an opener about the decision nobody took on", () => {
    expect(
      findHeadlineRepeat(
        "Your team agreed the crew would hear about the Dunleavy credit. Nobody said who would tell them. Who tells the crew?",
        HEADLINE
      )
    ).toBeNull();
  });

  // Either half alone is ordinary.
  it("passes the same event with a new question", () => {
    expect(
      findHeadlineRepeat(
        "Your team found that nobody owned the calendar on Tuesday, for the third week. The Function Lead took it on. What should the first version of the process cover?",
        HEADLINE
      )
    ).toBeNull();
  });

  it("does nothing when there is no headline", () => {
    expect(findHeadlineRepeat(REPEATING_OPENER, null)).toBeNull();
  });

  it("points the retry at new ground", () => {
    const text = headlineRepeatRetryInstruction(HEADLINE);
    expect(text).toContain("Start from something new");
    expect(text).toMatch(/nobody\s+took on/);
  });
});
