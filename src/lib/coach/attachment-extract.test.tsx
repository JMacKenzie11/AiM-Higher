import { describe, expect, it } from "vitest";
import { Document, Page, Text, renderToBuffer } from "@react-pdf/renderer";
import { extractAttachment } from "./attachment-extract";
import { ATTACHMENT_MAX_BYTES } from "./attachments";

const enc = (s: string) => new TextEncoder().encode(s);

describe("reading an attached file", () => {
  it("reads a PDF's text", async () => {
    const pdf = await renderToBuffer(
      <Document>
        <Page>
          <Text>Customers choose us because we answer the phone.</Text>
        </Page>
      </Document>
    );
    const r = await extractAttachment({ name: "Why us.pdf", type: "application/pdf", bytes: new Uint8Array(pdf) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toContain("we answer the phone");
  }, 60_000);

  it("reads text and Markdown as they are", async () => {
    const r = await extractAttachment({ name: "notes.md", type: "", bytes: enc("# Offer\r\n\r\n\r\n\r\nWe build.  \n") });
    expect(r).toEqual({ ok: true, name: "notes.md", text: "# Offer\n\nWe build.", truncated: false });
  });

  it("refuses a kind of file it can't read", async () => {
    const r = await extractAttachment({ name: "deck.pptx", type: "application/vnd.ms-powerpoint", bytes: enc("x") });
    expect(r.ok).toBe(false);
  });

  it("refuses a file over the limit", async () => {
    const r = await extractAttachment({ name: "big.txt", type: "text/plain", bytes: new Uint8Array(ATTACHMENT_MAX_BYTES + 1) });
    expect(r).toMatchObject({ ok: false, message: expect.stringContaining("4 MB") });
  });

  it("says so when a file has no text", async () => {
    const r = await extractAttachment({ name: "blank.txt", type: "text/plain", bytes: enc("  \n ") });
    expect(r).toEqual({ ok: false, message: "That file is empty." });
  });

  it("says so when a PDF can't be read", async () => {
    const r = await extractAttachment({ name: "broken.pdf", type: "application/pdf", bytes: enc("not a pdf") });
    expect(r.ok).toBe(false);
  });
});
