import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseVividVision } from "./vivid-vision";
import { TEAM_RETURN_LINE, TEAM_STEPS, renderVividVisionPdf, vividVisionFileName } from "./vivid-vision-pdf";
import { PLAIN_VISION, STRUCTURED_VISION } from "./vivid-vision.fixture";

// The vivid vision PDF renders from a structured block and from a plain
// one written before the structure. VV_PDF_OUT=<path> writes the
// structured one out, to look at.
describe("the vivid vision PDF", () => {
  it("renders a structured vision", async () => {
    const v = parseVividVision(STRUCTURED_VISION)!;
    const pdf = await renderVividVisionPdf(v.doc, "Harbour Build", 2036);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect((pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThanOrEqual(1);
    if (process.env.VV_PDF_OUT) writeFileSync(process.env.VV_PDF_OUT, pdf);
  }, 60_000);

  it("renders a plain vision written before the structure", async () => {
    const v = parseVividVision(PLAIN_VISION)!;
    const pdf = await renderVividVisionPdf(v.doc, "Acme", 2036);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  }, 60_000);

  it("ends with the four steps for taking it to the team", () => {
    expect(TEAM_STEPS.map((t) => t.step)).toEqual([
      "Bring your team together and read your Vivid Vision.",
      "Ask them these questions:",
      "Give them some time to reflect individually, then ask them to share.",
      "Tell them you'll incorporate their feedback into the Vision and reshare it with them.",
    ]);
    expect(TEAM_STEPS[1].questions).toHaveLength(3);
    // And where the feedback goes.
    expect(TEAM_RETURN_LINE).toContain("return to your Vivid Vision conversation in AiMS-HQ");
  });

  it("names the file for the company and year", () => {
    expect(vividVisionFileName("Harbour Build", 2036)).toBe("Harbour Build Vivid Vision 2036.pdf");
  });
});
