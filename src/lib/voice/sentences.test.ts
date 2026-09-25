import { describe, it, expect } from "vitest";
import {
  splitSentences,
  findLongSentences,
  longSentenceRetryInstruction,
} from "./sentences";

// The real opener: 21, 17, 22 and 30 words, from a prompt that asked
// for "SHORT sentences".
const OPENER = `Third week running for that Tuesday collision, and this time it stopped at "who owns the calendar" instead of another patch. That took someone actually asking what was underneath the pattern instead of just fixing the latest instance.

You were in the room for that one, and also picked up two of your own commitments out of the margin conversation. Before we get to those: what do you think made it possible for the group to name the calendar ownership gap this time, instead of the third time it happened?`;

describe("findLongSentences", () => {
  it("counts the real opener", () => {
    expect(splitSentences(OPENER).map((s) => s.split(" ").length)).toEqual([
      21, 17, 22, 30,
    ]);
  });

  it("flags only what is over the limit", () => {
    expect(findLongSentences(OPENER, 20).map((s) => s.words)).toEqual([21, 22, 30]);
  });

  it("passes short sentences and one question", () => {
    expect(
      findLongSentences(
        "The team agreed to tell the crew about the credit. Nobody said who would. Who tells the crew?",
        20
      )
    ).toEqual([]);
  });

  it("splits on a blank line as well as on punctuation", () => {
    expect(splitSentences("One line\n\nAnother line")).toEqual(["One line", "Another line"]);
  });

  it("names the sentence and its count in the retry", () => {
    const text = longSentenceRetryInstruction(findLongSentences(OPENER, 20), 20);
    expect(text).toContain("(30 words)");
    expect(text).toContain("longer than 20 words");
  });
});
