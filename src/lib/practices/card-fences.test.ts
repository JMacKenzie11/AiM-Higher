import { describe, it, expect } from "vitest";
import { cardFencesOnOwnLine } from "./output-cards";

// A card's fence written straight after a sentence rendered as raw JSON
// (dev, 2026-10-05: "...in that session?```session_offer"). Moved onto
// its own line, for card tags only.

describe("cardFencesOnOwnLine", () => {
  it("moves a card fence that follows a sentence onto its own line", () => {
    expect(cardFencesOnOwnLine('Shall we?```session_offer\n{"a": 1}\n```')).toBe('Shall we?\n\n```session_offer\n{"a": 1}\n```');
    expect(cardFencesOnOwnLine("Here it is. ```commitment\n{}\n```")).toBe("Here it is.\n\n```commitment\n{}\n```");
  });

  it("leaves a fence that already starts a line alone", () => {
    const ok = 'Shall we?\n\n```session_offer\n{"a": 1}\n```';
    expect(cardFencesOnOwnLine(ok)).toBe(ok);
  });

  it("leaves other fences, and the closing fence, alone", () => {
    const code = "Try this:```python\nprint(1)\n```";
    expect(cardFencesOnOwnLine(code)).toBe(code);
    const closing = '```session_offer\n{"a": 1}```';
    expect(cardFencesOnOwnLine(closing)).toBe(closing);
  });
});
