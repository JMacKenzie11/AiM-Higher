import { describe, it, expect } from "vitest";
import {
  checkDebriefReply,
  describeReplyFaults,
  replyFaultCount,
  replyRetryInstruction,
  rewriteRequest,
  stripRetryPreamble,
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

// Jason's dev debrief, 2026-09-29: the retry answered the note it was
// sent back with, as if he had corrected her, and he read it.
const LEAKED =
  "Fair. Let me redo that part. The meeting left one thing moving: the pricing review is now next month. Who is best placed to own getting ready for it?";

describe("talking about a previous attempt", () => {
  it("is a fault: the reply opens by acknowledging a correction", () => {
    const f = checkDebriefReply(LEAKED, "");
    expect(f.meta).toEqual(["Fair.", "Let me redo that part."]);
    expect(replyFaultCount(f)).toBe(2);
    expect(describeReplyFaults(f)).toContain('talked about a previous attempt "Fair."');
  });

  it("is a fault anywhere it mentions an earlier version", () => {
    expect(checkDebriefReply("Here it is without the phrase from my last version. Who owns it?", "").meta).toHaveLength(1);
    expect(checkDebriefReply("You're right, I shouldn't have quoted that. Who owns it?", "").meta).toHaveLength(1);
  });

  it("leaves an ordinary opening alone", () => {
    for (const ok of [
      "Fair question. The pricing review moved to next month.",
      "Let me pull up what the summary says about pricing.",
      "Right after the pricing debate, the team set a date.",
      "Your team got to a decision fast.",
    ]) {
      expect(checkDebriefReply(ok, "").meta, ok).toEqual([]);
    }
  });

  it("is stripped from the front of a retry before it is checked", () => {
    expect(stripRetryPreamble(LEAKED)).toBe(
      "The meeting left one thing moving: the pricing review is now next month. Who is best placed to own getting ready for it?"
    );
    expect(stripRetryPreamble("You're right. Got it, rewriting without it.\n\nThe team set a date.")).toBe("The team set a date.");
    expect(stripRetryPreamble("Fair question. The review moved.")).toBe("Fair question. The review moved.");
  });
});

describe("the request sent back", () => {
  it("asks for the whole message again, written as if for the first time", () => {
    const text = rewriteRequest("You used \"the room\".");
    expect(text.startsWith('You used "the room".')).toBe(true);
    expect(text).toMatch(/whole message/i);
    expect(text).toMatch(/never mention a previous version/i);
  });
});

// Jason, 2026-09-29, on the "after" example: "Put a name and a date on
// it, not just 'next month'" still contrasts with what did not happen.
describe("\"not just\"", () => {
  it("is a fault wherever it appears in Aimee's own words", () => {
    const f = checkDebriefReply("Put a name and a date on it, not just \"next month\". Who owns it?", "");
    expect(f.contrasts).toEqual(["not just"]);
    expect(replyFaultCount(f)).toBe(1);
    expect(replyRetryInstruction(f)).toMatch(/not just/);
    expect(describeReplyFaults(f)).toContain('contrast "not just"');
  });

  it("is left alone inside a quote of what somebody said", () => {
    expect(checkDebriefReply('Your team said "it is not just a pricing problem". Who owns it?', "").contrasts).toEqual([]);
  });
});
