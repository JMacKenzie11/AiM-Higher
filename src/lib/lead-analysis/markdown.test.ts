import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown, splitSections } from "./markdown";

describe("parseInline", () => {
  it("reads bold and italic", () => {
    expect(parseInline("A **bold** and *quiet* word")).toEqual([
      { text: "A " },
      { text: "bold", bold: true },
      { text: " and " },
      { text: "quiet", italic: true },
      { text: " word" },
    ]);
  });
});

describe("parseMarkdown", () => {
  it("reads the analyzer's shape", () => {
    const blocks = parseMarkdown(
      [
        "### A) Hiring",
        "",
        "**What Was Discussed**",
        "- First point",
        "  - Nested point",
        "- Second point",
        "  continues here",
        "",
        "1. One",
        "2. Two",
        "",
        "A paragraph",
        "on two lines.",
        "<!-- a comment -->",
        "---",
      ].join("\n")
    );
    expect(blocks).toEqual([
      { type: "heading", level: 3, text: "A) Hiring" },
      { type: "heading", level: 4, text: "What Was Discussed" },
      {
        type: "list",
        ordered: false,
        items: [
          { depth: 0, inline: [{ text: "First point" }] },
          { depth: 1, inline: [{ text: "Nested point" }] },
          { depth: 0, inline: [{ text: "Second point" }, { text: " continues here" }] },
        ],
      },
      {
        type: "list",
        ordered: true,
        items: [
          { depth: 0, inline: [{ text: "One" }] },
          { depth: 0, inline: [{ text: "Two" }] },
        ],
      },
      { type: "paragraph", inline: [{ text: "A paragraph on two lines." }] },
    ]);
  });

  it("keeps a bold lead-in on a bullet as part of the bullet", () => {
    const [list] = parseMarkdown("- **Trust** - the team held the line");
    expect(list).toEqual({
      type: "list",
      ordered: false,
      items: [{ depth: 0, inline: [{ text: "Trust", bold: true }, { text: " - the team held the line" }] }],
    });
  });
});

describe("splitSections", () => {
  it("splits on ## and not ###", () => {
    expect(splitSections("## Purpose of the Call\nWhy.\n### Sub\nMore.\n## Attendees\n- Dana")).toEqual([
      { title: "Purpose of the Call", body: "Why.\n### Sub\nMore." },
      { title: "Attendees", body: "- Dana" },
    ]);
  });
});
