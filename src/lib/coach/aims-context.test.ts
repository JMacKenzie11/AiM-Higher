import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { htmlToText, loadAimsDocuments, makeAboutAimsTool } from "./aims-context";

// Aimee's about_aims tool reads the GLOBAL documents in docs/AiMSContext
// themselves (Jason, 2026-10-04).

describe("htmlToText", () => {
  it("keeps headings and bullets, and drops every tag", () => {
    expect(htmlToText("<h1>AiMS <strong>Core</strong></h1><p>One &amp; two</p><ul><li>Slow the moment</li><li></li></ul>")).toBe(
      "## AiMS Core\nOne & two\n\n- Slow the moment"
    );
  });
});

describe("the AiMS documents", () => {
  it("are the two GLOBAL files, read in full as text", async () => {
    const docs = await loadAimsDocuments();
    expect(docs.map((d) => d.title)).toEqual([
      "GLOBAL - AiMS Core Beliefs (Ideology & Approach)-2",
      "GLOBAL - AiMS “POV” - MASTER",
    ]);
    const [beliefs, pov] = docs;
    expect(beliefs!.text).toContain("People don’t move together until they understand together.");
    expect(beliefs!.text).toMatch(/^- Slow the moment$/m);
    expect(pov!.text).toContain("Leadership is less about performing");
    for (const d of docs) {
      expect(d.text).not.toMatch(/<[a-z/][^>]*>/i);
      expect(d.text.length).toBeGreaterThan(5000);
    }
  });

  it("leave out every other file in the folder", async () => {
    const all = (await loadAimsDocuments()).map((d) => d.title).join(" ");
    expect(all).not.toMatch(/icp|positioning/i);
  });

  it("come back through the tool, which takes no arguments and says it is never the person's company", async () => {
    const tool = makeAboutAimsTool();
    expect(Object.keys((tool.definition.input_schema as { properties: object }).properties)).toEqual([]);
    expect(tool.definition.description).toMatch(/never information about the person's own company/);
    const out = (await tool.handler({})) as { status: string; documents: unknown[] };
    expect(out.status).toBe("ok");
    expect(out.documents).toHaveLength(2);
  });
});
