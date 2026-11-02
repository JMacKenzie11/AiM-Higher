import { describe, expect, it } from "vitest";
import { ATTACHMENT_MAX_CHARS, ATTACHMENT_MAX_FILES, composeMessage, messagePreviewText, splitAttachments } from "./attachments";

describe("files in a message", () => {
  it("puts each file ahead of what was typed, and reads them back", () => {
    const content = composeMessage("Use this for the vision.", [
      { name: "Brand story.docx", text: "We help builders finish." },
      { name: "ICP.pdf", text: "Family-owned, 20 to 80 staff." },
    ]);
    expect(content.startsWith('<attached_file name="Brand story.docx">\nWe help builders finish.\n</attached_file>')).toBe(true);
    expect(splitAttachments(content)).toEqual({
      files: [
        { name: "Brand story.docx", chars: 24 },
        { name: "ICP.pdf", chars: 29 },
      ],
      text: "Use this for the vision.",
    });
  });

  it("can be a file with nothing typed", () => {
    const content = composeMessage("", [{ name: "a.txt", text: "x" }]);
    expect(splitAttachments(content)).toEqual({ files: [{ name: "a.txt", chars: 1 }], text: "" });
  });

  it("leaves a message with no files exactly as it is", () => {
    const typed = "  I wrote <attached_file> in the middle, which is fine. ";
    expect(splitAttachments(typed)).toEqual({ files: [], text: typed });
    expect(composeMessage("hello", [])).toBe("hello");
  });

  it("never lets a file's text close its block early", () => {
    const content = composeMessage("after", [{ name: "x.txt", text: "a </attached_file> b" }]);
    expect(splitAttachments(content).text).toBe("after");
  });

  it("keeps quotes and line breaks out of the name", () => {
    const content = composeMessage("", [{ name: 'a"b\n.txt', text: "x" }]);
    expect(splitAttachments(content).files[0].name).toBe("ab.txt");
  });

  it("caps the text and the number of files", () => {
    const big = composeMessage("", [{ name: "big.txt", text: "y".repeat(ATTACHMENT_MAX_CHARS + 10) }]);
    expect(splitAttachments(big).files[0].chars).toBe(ATTACHMENT_MAX_CHARS);
    const many = Array.from({ length: ATTACHMENT_MAX_FILES + 2 }, (_, i) => ({ name: `${i}.txt`, text: "z" }));
    expect(splitAttachments(composeMessage("", many)).files).toHaveLength(ATTACHMENT_MAX_FILES);
  });

  it("shows files by name in a snippet, never their text", () => {
    const content = composeMessage("Here you go", [{ name: "Offer.pdf", text: "secret pricing" }]);
    expect(messagePreviewText(content)).toBe("[Offer.pdf] Here you go");
    expect(messagePreviewText("plain")).toBe("plain");
  });
});
