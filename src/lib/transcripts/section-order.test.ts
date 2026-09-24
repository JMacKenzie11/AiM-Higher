import { describe, it, expect } from "vitest";
import { coreValuesFirst, splitCoreValues } from "./section-order";

// Written last, shown first — and nothing else moves.

const DOC = `## Purpose of the Call
Weekly leadership meeting.

## Detailed Discussions
### A) Sanitation
Darlene flagged numbering.

## Decisions Made (Summary Section)
- Shutdown Oct 18–25

## Core Values in Action

**Where values showed up**
- **Care** — Nancy shared her glove tip unprompted.
`;

describe("coreValuesFirst", () => {
  it("moves Core Values to the top", () => {
    const out = coreValuesFirst(DOC);
    expect(out.trimStart().startsWith("## Core Values in Action")).toBe(true);
  });

  it("keeps every other section, in their original order", () => {
    const heads = (md: string) =>
      md.split("\n").filter((l) => /^##\s/.test(l)).map((l) => l.trim());
    const before = heads(DOC).filter((h) => !/Core Values/.test(h));
    const after = heads(coreValuesFirst(DOC)).filter((h) => !/Core Values/.test(h));
    expect(after).toEqual(before);
  });

  it("keeps the section's own content with it", () => {
    const out = coreValuesFirst(DOC);
    const firstOther = out.indexOf("## Purpose of the Call");
    expect(out.slice(0, firstOther)).toContain("Nancy shared her glove tip");
  });

  it("loses nothing", () => {
    // Every non-blank line survives the move. A transform that
    // silently dropped a discussion would be far worse than one that
    // left the order alone.
    const lines = (md: string) =>
      md.split("\n").map((l) => l.trim()).filter(Boolean).sort();
    expect(lines(coreValuesFirst(DOC))).toEqual(lines(DOC));
  });

  it("returns the document untouched when there is no values section", () => {
    // The ORDINARY case. The prompt says to omit the section rather
    // than manufacture one, so most meetings have none.
    const plain = "## Purpose of the Call\nA meeting.\n";
    expect(coreValuesFirst(plain)).toBe(plain);
  });

  it("handles an older numbered heading", () => {
    // Analyses stored before the rename carry "## 7. Values in
    // Practice". They render through the same path.
    const old = DOC.replace(
      "## Core Values in Action",
      "## 7. Values in Practice"
    );
    expect(coreValuesFirst(old).trimStart().startsWith("## 7. Values in Practice")).toBe(true);
  });

  it("leaves a document that already starts with it alone", () => {
    const already = coreValuesFirst(DOC);
    expect(coreValuesFirst(already)).toBe(already);
  });

  it("survives a values section that runs to the end with no heading after", () => {
    const out = coreValuesFirst(DOC);
    expect(out).toContain("## Decisions Made (Summary Section)");
    expect(out).toContain("- Shutdown Oct 18–25");
  });
});

describe("splitCoreValues", () => {
  it("returns the section body without its heading, and the rest", () => {
    const { values, rest } = splitCoreValues(DOC);
    expect(values).toContain("Nancy shared her glove tip");
    expect(values).not.toContain("## Core Values in Action");
    expect(rest).toContain("## Purpose of the Call");
    expect(rest).not.toContain("Nancy shared her glove tip");
  });

  it("loses nothing between the two halves", () => {
    const { values, rest } = splitCoreValues(DOC);
    const lines = (md: string) =>
      md.split("\n").map((l) => l.trim()).filter(Boolean);
    const out = [...lines(values ?? ""), ...lines(rest)].sort();
    const original = lines(DOC)
      .filter((l) => l !== "## Core Values in Action")
      .sort();
    expect(out).toEqual(original);
  });

  it("reports no values section rather than an empty one", () => {
    // The caller renders no card at all in this case, which is the
    // ordinary outcome — the prompt omits the section rather than
    // manufacture one.
    const plain = "## Purpose of the Call\nA meeting.\n";
    expect(splitCoreValues(plain)).toEqual({ values: null, rest: plain });
  });

  it("handles an empty document", () => {
    // The page calls this with "" before an analysis exists.
    expect(splitCoreValues("")).toEqual({ values: null, rest: "" });
  });
});
