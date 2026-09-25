import { describe, it, expect } from "vitest";
import {
  findUnsupportedQuotes,
  quoteRetryInstruction,
  unquoteUnsupported,
} from "./quotes";

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

// The transcript is the source now, and the real case is why: the
// summary quoted "who owns the calendar", nobody said it, and an
// opener quoting the summary passed a check against the summary.
const TRANSCRIPT = `Speaker 1: So what's actually underneath it? Because we keep fixing the
Tuesday and we don't fix the thing that makes Tuesdays collide.

Speaker 2: Honestly? Nobody owns the calendar. I assume Ray's updating it.`;

describe("checked against the transcript", () => {
  it("catches a quote the summary invented and the opener repeated", () => {
    const hits = findUnsupportedQuotes(
      `This time it stopped at "who owns the calendar" instead of another patch.`,
      TRANSCRIPT
    );
    expect(hits.map((h) => h.quote)).toEqual(["who owns the calendar"]);
  });

  it("passes a real quote that runs across a line break", () => {
    expect(
      findUnsupportedQuotes(
        `"we keep fixing the Tuesday and we don't fix the thing"`,
        TRANSCRIPT
      )
    ).toEqual([]);
  });

  it("checks curly quotes, which the first version never matched", () => {
    expect(
      findUnsupportedQuotes(`It stopped at “who owns the calendar” this time.`, TRANSCRIPT)
    ).toHaveLength(1);
  });

  it("names the transcript in the retry", () => {
    expect(quoteRetryInstruction([{ quote: "who owns the calendar" }])).toContain(
      "not in the meeting transcript"
    );
  });
});

describe("unquoteUnsupported", () => {
  it("takes the marks off a paraphrase and keeps the words", () => {
    const { text, unquoted } = unquoteUnsupported(
      `The discussion moved from "who moved the crew" to "who owns the calendar".`,
      TRANSCRIPT
    );
    expect(text).toBe(
      "The discussion moved from who moved the crew to who owns the calendar."
    );
    expect(unquoted).toEqual(["who moved the crew", "who owns the calendar"]);
  });

  it("leaves a real quote and a short term alone", () => {
    const input = `She said "Nobody owns the calendar." It was the "Tuesday" problem.`;
    expect(unquoteUnsupported(input, TRANSCRIPT)).toEqual({
      text: input,
      unquoted: [],
    });
  });
});

describe("quote marks inside a quote", () => {
  // The real false positive, 2026-09-25: the transcript has double
  // quotes inside the line, the summary nested single ones, and a
  // real quote lost its marks as though it were a paraphrase.
  const SAID = `Speaker 1: Yes. Not as a blame thing. As a "this is what it cost"\nthing.`;

  it("keeps a real quote whose inner marks changed", () => {
    const input = `Speaker 1 said "Yes. Not as a blame thing. As a 'this is what it cost' thing."`;
    expect(unquoteUnsupported(input, SAID).unquoted).toEqual([]);
    expect(findUnsupportedQuotes(input, SAID)).toEqual([]);
  });

  it("still catches an invented one", () => {
    expect(
      findUnsupportedQuotes(`She said "this is what it cost us all".`, SAID)
    ).toHaveLength(1);
  });
});
