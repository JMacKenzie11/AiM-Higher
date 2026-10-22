import { describe, it, expect } from "vitest";
import { validateQuoteLines, MAX_SUGGESTED } from "./quote-lines";

const notes = `Quotes take my whole morning, every morning.
I'd rather be out on the floor with the guys solving real problems.
Honestly the inbox decides my day before I do.
My mother has been sick so I've been leaving early.`;

describe("suggested quote lines", () => {
  it("keeps the person's own words, whatever the quotation marks and spacing", () => {
    expect(
      validateQuoteLines({ lines: ["Quotes take my whole morning, every morning.", "“I’d rather be out on the floor  with the guys solving real problems.”"] }, notes, [])
    ).toEqual(["Quotes take my whole morning, every morning.", "I’d rather be out on the floor  with the guys solving real problems."]);
  });

  it("drops a paraphrase, a line already listed, a fragment and anything private", () => {
    expect(
      validateQuoteLines(
        {
          lines: [
            "Quoting eats every morning.",
            "the inbox decides my day before I do",
            "Quotes take",
            "My mother has been sick so I've been leaving early.",
          ],
        },
        notes,
        ["The inbox decides my day before I do."]
      )
    ).toEqual([]);
  });

  it("returns at most six and survives a malformed reply", () => {
    const many = Array.from({ length: 10 }, (_, i) => `line number ${i} said here`);
    expect(validateQuoteLines({ lines: many }, many.join("\n"), [])).toHaveLength(MAX_SUGGESTED);
    expect(validateQuoteLines(null, notes, [])).toEqual([]);
    expect(validateQuoteLines({ lines: "nope" }, notes, [])).toEqual([]);
  });
});
