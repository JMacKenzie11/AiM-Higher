import { describe, it, expect } from "vitest";
import { findOffThread, findHeadlineRepeat, headlineRepeatRetryInstruction } from "./repetition";

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

  it("keeps the subject and asks the next question, rather than sending it elsewhere", () => {
    // It used to say "Start from something new in the summary", which
    // pushed the retry onto a different moment of the meeting.
    const text = headlineRepeatRetryInstruction(HEADLINE);
    expect(text).toContain("Keep its subject");
    expect(text).not.toContain("something new");
  });
});

describe("findOffThread", () => {
  const SCHEDULING =
    "Your team traced the Tuesday scheduling clashes back to a real gap: nobody owned the calendar. Is it worth five minutes to look at what made that diagnosis stick?";

  it("catches the real jump: a scheduling line answered about the quoting sheet", () => {
    expect(
      findOffThread(
        "The quoting sheet held up through three live quotes with no confusion reported. Where else could a new process get that kind of clean run?",
        SCHEDULING
      )
    ).toBe(true);
  });

  it("passes an opener that stays on the subject with a new question", () => {
    expect(
      findOffThread(
        "The calendar question got a real answer this time: operations owns it. Where else is something bouncing between people the way that Tuesday schedule was?",
        SCHEDULING
      )
    ).toBe(false);
  });

  it("does not count the line's stock question or generic words as the subject", () => {
    // "five", "minutes" and "team" are in the line, and in this opener,
    // and are not the subject.
    expect(
      findOffThread("Your team spent five minutes on the quoting sheet. Where else could that work?", SCHEDULING)
    ).toBe(true);
  });

  it("has nothing to check when they arrived without a line", () => {
    expect(findOffThread("Anything at all.", null)).toBe(false);
  });
});
