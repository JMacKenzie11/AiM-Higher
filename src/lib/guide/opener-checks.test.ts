import { describe, it, expect } from "vitest";
import {
  checkOpener,
  faultCount,
  openerRetryInstruction,
  OPENER_MAX_WORDS_PER_SENTENCE,
} from "./opener-checks";

const HEADLINE =
  "You traced the Tuesday scheduling conflict past its third repeat and found the real gap: nobody owned the calendar. That's the kind of root-cause instinct that stops a recurring problem cold. Is it worth five minutes to look at what made it work?";
const TRANSCRIPT =
  "Speaker 2: Honestly? Nobody owns the calendar. I assume Ray's updating it.\n\nSpeaker 3: Are we telling the crew about it?";
const SUMMARY = 'The discussion moved to "who owns the calendar".';

const REAL_OPENER = `Third week running for that Tuesday collision, and this time it stopped at "who owns the calendar" instead of another patch. That took someone actually asking what was underneath the pattern instead of just fixing the latest instance.

You were in the room for that one, and also picked up two of your own commitments out of the margin conversation. Before we get to those: what do you think made it possible for the group to name the calendar ownership gap this time, instead of the third time it happened?`;

const debrief = {
  transcript: TRANSCRIPT,
  summary: SUMMARY,
  headline: HEADLINE,
  maxWordsPerSentence: OPENER_MAX_WORDS_PER_SENTENCE,
};

describe("checkOpener", () => {
  it("finds all four faults in the real opener", () => {
    const f = checkOpener(REAL_OPENER, debrief);
    expect(f.invented.map((q) => q.quote)).toEqual(["who owns the calendar"]);
    expect(f.repeat).not.toBeNull();
    expect(f.long.map((s) => s.words)).toEqual([21, 22, 30]);
    expect(f.banned.map((h) => h.phrase)).toEqual(
      expect.arrayContaining(["the room", "X instead of Y"])
    );
  });

  it("passes the opening the meeting actually offered", () => {
    const f = checkOpener(
      "Your team agreed the crew would hear about the Dunleavy credit. Nobody said who would tell them. Who tells the crew?",
      debrief
    );
    expect(faultCount(f)).toBe(0);
  });

  it("falls back to the summary when the transcript is unreadable", () => {
    // The summary's own quotation marks are verified when it is
    // written, so a quote found there was said.
    const f = checkOpener('It came down to "who owns the calendar".', {
      ...debrief,
      transcript: "",
    });
    expect(f.invented).toEqual([]);
  });

  it("holds only the debrief to the sentence limit", () => {
    const f = checkOpener(REAL_OPENER, {
      transcript: "",
      summary: "",
      headline: null,
      maxWordsPerSentence: null,
    });
    expect(f.long).toEqual([]);
  });

  it("names the invented quote first in the retry", () => {
    const text = openerRetryInstruction(checkOpener(REAL_OPENER, debrief), HEADLINE);
    expect(text.indexOf("not in the meeting transcript")).toBeLessThan(
      text.indexOf("Start from something new")
    );
    expect(text).toContain("(30 words)");
  });
});
