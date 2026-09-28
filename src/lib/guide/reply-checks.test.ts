import { describe, it, expect } from "vitest";
import {
  checkDebriefReply,
  describeReplyFaults,
  replyFaultCount,
  replyRetryInstruction,
} from "./reply-checks";

// The fixture meeting's real lines (scripts/fixtures/leadership-meeting.txt).
const TRANSCRIPT =
  "Speaker 1: Is it ours?\n\nSpeaker 2: Partly. About half of it is genuinely on us.\n\n" +
  "Speaker 2: I want it to stop happening, so yes.";

// Jason's dev debrief, 2026-09-28, the first reply after "Sure".
const REAL =
  'That instinct, splitting the credit fifty-fifty instead of arguing it to zero or caving to the whole amount, came straight from someone cutting to "is it ours" before anyone talked numbers. ' +
  'That\'s a different starting question than "how much do they want" or "how do we make this go away." ' +
  'You were in the room for that.';

describe("checkDebriefReply", () => {
  it("finds every fault in the real reply, and passes its real quote", () => {
    const f = checkDebriefReply(REAL, TRANSCRIPT);
    expect(f.invented.map((q) => q.quote)).toEqual(["how much do they want", "how do we make this go away."]);
    expect(f.banned.map((h) => h.phrase)).toEqual(expect.arrayContaining(["the room", "X instead of Y"]));
    expect(replyFaultCount(f)).toBe(f.invented.length + f.banned.length);
  });

  it("catches affirming by denial", () => {
    const f = checkDebriefReply("Nobody had a bad intent here, and that's how a gap survives.", TRANSCRIPT);
    expect(f.denials).toEqual(["Nobody had a bad intent here, and that's how a gap survives"]);
    expect(checkDebriefReply("This isn't about blame.", "").denials).toHaveLength(1);
  });

  it("skips the quote check when the transcript could not be read", () => {
    expect(checkDebriefReply('"how much do they want"', "").invented).toEqual([]);
  });

  it("passes a clean reply", () => {
    expect(
      replyFaultCount(
        checkDebriefReply(
          'Everyone\'s answer made sense on its own. "I want it to stop happening, so yes" is a clean claim. Who tells the crew?',
          TRANSCRIPT
        )
      )
    ).toBe(0);
  });
});

describe("the retry", () => {
  it("names the invented quote first, then the rest", () => {
    const text = replyRetryInstruction(checkDebriefReply(REAL, TRANSCRIPT));
    expect(text.startsWith('You quoted "how much do they want"')).toBe(true);
    expect(text).toContain("the room");
  });

  it("says what was wrong in one log line", () => {
    const line = describeReplyFaults(checkDebriefReply(REAL, TRANSCRIPT));
    expect(line).toMatch(/^invented quote\(s\) "how much do they want"/);
    expect(line).toContain("X instead of Y");
  });
});
