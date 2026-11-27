import { describe, it, expect } from "vitest";
import { momentFound, transcriptIndex } from "./verify";

const transcript = [
  "Dana Reyes: Before we start, thank you all. Big week.",
  "Let's go around, something good from your week.",
  "Marcus: Our new driver did the whole east loop solo on Thursday.",
].join("\n");
const index = transcriptIndex(transcript);

describe("momentFound", () => {
  it("finds exact words, ignoring case, punctuation and the speaker's name", () => {
    expect(momentFound("thank you all big week", index)).toBe(true);
    expect(momentFound("Marcus: our new driver did the whole east loop", index)).toBe(true);
  });

  it("finds words that a recording split across lines", () => {
    expect(momentFound("Big week. Let's go around, something good", index)).toBe(true);
  });

  it("refuses a paraphrase", () => {
    expect(momentFound("Dana thanked everyone for a big week", index)).toBe(false);
  });

  it("refuses a moment too short to mean anything", () => {
    expect(momentFound("big week", index)).toBe(false);
    expect(momentFound(null, index)).toBe(false);
  });

  it("matches whole words only", () => {
    expect(momentFound("ur new driver did", index)).toBe(false);
  });
});

describe("momentFound, tolerant of a word or two", () => {
  const idx = transcriptIndex("Sam: So we're just gonna shut it down for that week and I'll put a post out.");
  it("accepts a moment with a dropped filler word", () => {
    expect(momentFound("we're just going to shut it down for that week and I'll put a post out", idx)).toBe(true);
  });
  it("still refuses a paraphrase built from the same words", () => {
    expect(momentFound("Sam said the team will shut down for the week and post about it", idx)).toBe(false);
  });
});
