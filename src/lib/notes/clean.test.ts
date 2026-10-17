import { describe, expect, it } from "vitest";
import { cleanNotes, notesFirstLine, notesText, safeHref } from "./clean";

const p = (...content: unknown[]) => ({ type: "paragraph", content });
const t = (text: string, marks?: unknown[]) => ({ type: "text", text, ...(marks ? { marks } : {}) });
const doc = (...content: unknown[]) => ({ type: "doc", content });

describe("cleanNotes", () => {
  it("keeps the five kinds of formatting", () => {
    const input = doc(
      p(t("Plain "), t("bold", [{ type: "bold" }]), t(" and "), t("italic", [{ type: "italic" }])),
      { type: "bulletList", content: [{ type: "listItem", content: [p(t("one"))] }] },
      { type: "orderedList", attrs: { start: 3 }, content: [{ type: "listItem", content: [p(t("three"))] }] },
      p(t("site", [{ type: "link", attrs: { href: "https://example.com/a" } }]))
    );
    expect(cleanNotes(input)).toEqual(input);
  });

  it("drops a link that is not a web or email address, and keeps its text", () => {
    const out = cleanNotes(doc(p(t("click", [{ type: "link", attrs: { href: "javascript:alert(1)" } }]))));
    expect(out).toEqual(doc(p(t("click"))));
  });

  it("drops unknown marks and attributes", () => {
    const out = cleanNotes(
      doc(p({ type: "text", text: "x", marks: [{ type: "textStyle", attrs: { color: "red" } }, { type: "bold", attrs: { onclick: "y" } }] }))
    );
    expect(out).toEqual(doc(p(t("x", [{ type: "bold" }]))));
  });

  it("turns headings, quotes and code into plain paragraphs", () => {
    const out = cleanNotes(
      doc(
        { type: "heading", attrs: { level: 1 }, content: [t("Title")] },
        { type: "blockquote", content: [p(t("quoted"))] },
        { type: "codeBlock", content: [t("<script>")] }
      )
    );
    expect(out).toEqual(doc(p(t("Title")), p(t("quoted")), p(t("<script>"))));
  });

  it("drops images and embeds", () => {
    const out = cleanNotes(doc(p(t("a")), { type: "image", attrs: { src: "https://x/y.png" } }, { type: "videoEmbed" }));
    expect(out).toEqual(doc(p(t("a"))));
  });

  it("stores an empty note as null", () => {
    expect(cleanNotes(doc(p(), p(t("   "))))).toBeNull();
    expect(cleanNotes(null)).toBeNull();
    expect(cleanNotes("<b>hi</b>")).toBeNull();
  });
});

describe("notesText", () => {
  it("reads lists and paragraphs as lines", () => {
    const d = doc(
      p(t("Context")),
      { type: "bulletList", content: [{ type: "listItem", content: [p(t("a"))] }, { type: "listItem", content: [p(t("b"))] }] },
      { type: "orderedList", content: [{ type: "listItem", content: [p(t("first"))] }] }
    );
    expect(notesText(d)).toBe("Context\n- a\n- b\n1. first");
    expect(notesFirstLine(d)).toBe("Context");
  });
});

describe("safeHref", () => {
  it("allows http, https and mailto only", () => {
    expect(safeHref("https://a.com")).toBe("https://a.com/");
    expect(safeHref("mailto:x@y.com")).toBe("mailto:x@y.com");
    expect(safeHref("data:text/html,hi")).toBeNull();
    expect(safeHref("javascript:void(0)")).toBeNull();
    expect(safeHref("/relative")).toBeNull();
  });
});
