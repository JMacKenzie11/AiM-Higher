import { describe, it, expect } from "vitest";
import { checkFirstReply, firstReplyFaultCount, firstReplyRetryInstruction, firstReplyRules } from "./first-reply-checks";

// The real first replies from the 2026-09-29 test runs.
describe("checkFirstReply", () => {
  it("catches her name at the start", () => {
    const f = checkFirstReply("I'm Aimee, the AiMS Leadership Coach. Happy to work through this with you. What's going on?");
    expect(f.introducedHerself).toBe(true);
    expect(firstReplyRules(f)).toContain("introduced herself");
  });

  it("catches any opening That's", () => {
    expect(checkFirstReply("That's a shift worth paying attention to, especially from someone who's usually a driver. What's been happening in those meetings?").startsWithThats).toBe(true);
    expect(checkFirstReply("That's a jolt to get, especially if it landed without much warning. What's been happening with them lately?").startsWithThats).toBe(true);
  });

  it("catches two asks, joined or separate", () => {
    for (const reply of [
      "That's a real problem to have surfaced. What have you found out so far, and how long has this been going on?",
      "Three weeks in and still mid-onboarding is worth a real look. What's been happening, is it that tasks are stalled, or is it not clear what's actually left to finish?",
      "That's a tough thing to hear. What's been going on with them lately, or what did they say when they brought it up?",
      "Okay. What happened? How did you find out?",
    ]) {
      expect(checkFirstReply(reply).questions.length, reply).toBeGreaterThan(0);
    }
  });

  it("catches an opening That's without especially, an opening Okay, and actually in the question (Jason, 2026-09-30)", () => {
    expect(checkFirstReply("That's a lot to carry into a conversation like this one. What's been happening with them?").startsWithThats).toBe(true);
    expect(checkFirstReply("Okay, that's a tough one to watch play out in real time. What's been happening between them?").startsWithOkay).toBe(true);
    expect(checkFirstReply('What does "terrible at paperwork" actually look like week to week?').actuallyInQuestion).toBe(true);
    expect(checkFirstReply("It actually helps that you caught it early. What have you found so far?").actuallyInQuestion).toBe(false);
    expect(checkFirstReply("Being sharp on the numbers is worth a lot. What's that like for the team?").startsWithThats).toBe(false);
  });

  it("catches rather than, instead of and not just, outside quotes (Jason, 2026-09-30)", () => {
    expect(checkFirstReply("He'd rather carry it himself than hand it off, and that's catching up with him. What does that look like day to day?").contrasts).toEqual(["rather than"]);
    expect(checkFirstReply("Rather a lot is riding on this. What's been happening?").contrasts).toEqual([]);
    expect(checkFirstReply("Carrying it himself rather than handing it off is wearing. What does that look like?").contrasts).toEqual(["rather than"]);
    expect(checkFirstReply("Doing it instead of delegating costs time. What's been happening?").contrasts).toEqual(["instead of"]);
    expect(checkFirstReply("It's not just the paperwork. What's been happening?").contrasts).toEqual(["not just"]);
    expect(checkFirstReply('You said "not just the deadlines". What else is going on?').contrasts).toEqual([]);
  });

  it("names a skipped strength in the rules and the retry", () => {
    const f = { ...checkFirstReply("What's been happening with the paperwork?"), skippedStrength: "great with the crew" };
    expect(firstReplyRules(f)).toContain("skipped a named strength");
    expect(firstReplyRetryInstruction(f)).toMatch(/"great with the crew"\)\. Acknowledge it first/);
  });

  it("passes the replies that got it right", () => {
    for (const reply of [
      "Let's look at it. What's been happening between them?",
      "Three weeks in and still stuck in onboarding is worth a second look. What's holding it up?",
      "Two of your people going at it where everyone can see it puts you in a tough spot.\n\nWhat's been happening between them?",
      'They said "is anybody using these, and why?" What made that question land for you?'.replace(" land", " stick"),
    ]) {
      expect(firstReplyFaultCount(checkFirstReply(reply)), reply).toBe(0);
    }
  });

  it("sends it back as a replacement, not a correction to answer", () => {
    const text = firstReplyRetryInstruction(checkFirstReply("I'm Aimee. What happened, and when?"));
    expect(text).toMatch(/leave it out/);
    expect(text).toMatch(/Ask one open question/);
    expect(text).toMatch(/never mention a previous version/);
  });
});
