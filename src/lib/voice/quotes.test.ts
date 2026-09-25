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

describe("a quote with a stretch left out", () => {
  // Real, 2026-09-25: a Benson summary quote lost its marks because
  // the "..." was compared as text.
  const SAID =
    "Speaker 1: Technically, all of the foreign workers are under Benson Seafood, well, no, under Benson Lobster.";

  it("keeps it when every piece is there, in order", () => {
    const input = `"Technically, all of the foreign workers are under Benson Seafood... under Benson Lobster,"`;
    expect(unquoteUnsupported(input, SAID).unquoted).toEqual([]);
    expect(findUnsupportedQuotes(input.replace("...", "…"), SAID)).toEqual([]);
  });

  it("catches pieces that are there but out of order", () => {
    expect(
      findUnsupportedQuotes(`"under Benson Lobster... all of the foreign workers"`, SAID)
    ).toHaveLength(1);
  });

  it("catches a piece that is not there at all", () => {
    expect(
      findUnsupportedQuotes(`"all of the foreign workers... are paid weekly"`, SAID)
    ).toHaveLength(1);
  });
});

describe("fillers and stutters", () => {
  const SAID = "Speaker 1: if if Nancy's winning every week, yeah, I might need to come up with something to.";

  it("keeps a real quote that was tidied", () => {
    expect(
      findUnsupportedQuotes(`"If Nancy's winning every week, I might need to come up with something"`, SAID)
    ).toEqual([]);
  });

  it("still catches a change of words", () => {
    expect(
      findUnsupportedQuotes(`"If Nancy keeps winning every week, I might need to come up with something"`, SAID)
    ).toHaveLength(1);
  });
});

describe("a bracketed insertion", () => {
  const SAID = "Speaker 2: Are they coming printed or just the phone? Like a file.";
  it("keeps a quote whose only change is a bracketed word", () => {
    expect(findUnsupportedQuotes(`"Are they coming printed or just the phone [file]?"`, SAID)).toEqual([]);
  });
  it("still checks what is outside the brackets", () => {
    expect(findUnsupportedQuotes(`"Are they coming laminated [file] or just the phone?"`, SAID)).toHaveLength(1);
  });
});

describe("a sentence split by a speaker marker", () => {
  const SAID = `Speaker 4  13:30
you kind of need to lock in for the season, right? But whether you use it

Speaker 1  13:34
for the month or not, you still have to pay for that kind of thing.`;

  it("keeps a real quote that runs across the marker", () => {
    expect(
      findUnsupportedQuotes(`"whether you use it for the month or not, you still have to pay"`, SAID)
    ).toEqual([]);
  });

  it("does not drop a line of speech", () => {
    expect(findUnsupportedQuotes(`"right? But for the month or not"`, SAID)).toHaveLength(1);
  });
});
