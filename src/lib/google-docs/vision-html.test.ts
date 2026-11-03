import { describe, expect, it } from "vitest";
import { parseVividVision, TEAM_RETURN_LINE, TEAM_STEPS } from "@/lib/foundation/vivid-vision";
import { STRUCTURED_VISION } from "@/lib/foundation/vivid-vision.fixture";
import { visionDocName, visionHtml } from "./vision-html";

const doc = parseVividVision(STRUCTURED_VISION)!.doc;
const html = visionHtml(doc, "Harbour Build", 2036);

describe("visionHtml", () => {
  it("lays out every part in the PDF's order", () => {
    const at = (s: string) => html.indexOf(s);
    expect(at("HARBOUR BUILD · VIVID VISION 2036")).toBeGreaterThan(-1);
    const order = [doc.title, "THE STORY", doc.story[0].headline, "PROOF POINTS", "WHAT WE PROTECT", "STRATEGIC FOCUS THEMES", doc.themes.items[0].name, "Connecting the Team to the Vision"];
    order.forEach((s) => expect(at(s), s).toBeGreaterThan(-1));
    for (let i = 1; i < order.length; i++) expect(at(order[i]), order[i]).toBeGreaterThan(at(order[i - 1]));
  });

  it("keeps the bold lines bold, and the team steps word for word", () => {
    expect(html).toMatch(/<b>[^<]+<\/b>/);
    expect(html).not.toContain("**");
    for (const t of TEAM_STEPS) expect(html).toContain(t.step.replace(/'/g, "'"));
    expect(html).toContain(TEAM_RETURN_LINE);
  });

  it("leaves out the One-Page Plan summary, as the PDF does", () => {
    expect(doc.summary.length).toBeGreaterThan(0);
    expect(html).not.toContain(doc.summary[0].slice(0, 40));
  });

  it("escapes what the leader wrote", () => {
    const evil = visionHtml({ ...doc, title: '<script>alert("x")</script>' }, "A & B", 2036);
    expect(evil).not.toContain("<script>");
    expect(evil).toContain("&lt;script&gt;");
    expect(evil).toContain("A &amp; B");
  });

  it("names the doc as the PDF is named", () => {
    expect(visionDocName("Harbour Build", 2036)).toBe("Harbour Build Vivid Vision 2036");
  });
});
