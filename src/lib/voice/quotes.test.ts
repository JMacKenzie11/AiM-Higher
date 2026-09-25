import { describe, it, expect } from "vitest";
import { findUnsupportedQuotes, quoteRetryInstruction } from "./quotes";

const SUMMARY = `
## Scheduling Ownership
The group asked what was actually underneath it, rather than fixing
the Tuesday again. Nobody owned the calendar.
`;

describe("findUnsupportedQuotes", () => {
  it("catches the invented half of a contrast", () => {
    // The real one. Nobody said "who screwed up the Tuesday"; it was
    // invented to make the sentence work.
    const hits = findUnsupportedQuotes(
      `The question was "what was actually underneath it" instead of "who screwed up the Tuesday."`,
      SUMMARY
    );
    expect(hits.map((h) => h.quote)).toEqual(["who screwed up the Tuesday."]);
  });

  it("passes a quote that is really in the summary", () => {
    expect(
      findUnsupportedQuotes(`She asked "what was actually underneath it".`, SUMMARY)
    ).toEqual([]);
  });

  it("survives the punctuation a model changes without meaning to", () => {
    // Curly quotes, a different apostrophe, an added full stop. A
    // real quote stays real through all of it.
    expect(
      findUnsupportedQuotes(
        `She asked “What was actually underneath it.”`,
        SUMMARY
      )
    ).toEqual([]);
  });

  it("ignores a short span, which is a term and not reported speech", () => {
    expect(findUnsupportedQuotes(`the "Tuesday" problem`, SUMMARY)).toEqual([]);
    expect(findUnsupportedQuotes(`a real "owner"`, SUMMARY)).toEqual([]);
  });

  it("reports each invented quote once", () => {
    const hits = findUnsupportedQuotes(
      `He said "we should ship it now" and again "we should ship it now".`,
      SUMMARY
    );
    expect(hits).toHaveLength(1);
  });

  it("passes text with no quotes at all", () => {
    expect(findUnsupportedQuotes("They traced it to the root.", SUMMARY)).toEqual([]);
  });
});

describe("quoteRetryInstruction", () => {
  it("says to drop the contrast rather than to find a quote for it", () => {
    const text = quoteRetryInstruction([{ quote: "who screwed up the Tuesday" }]);
    expect(text).toContain("Nobody said that");
    expect(text).toMatch(/describe it in your own\s+words/);
  });
});
