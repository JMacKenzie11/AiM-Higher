import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { vividVisionKeepBlock, writesVividVision } from "./vivid-vision-keep";

describe("vividVisionKeepBlock", () => {
  it("names the Google Doc only where the card has the button", () => {
    expect(vividVisionKeepBlock({ googleDocs: true })).toContain("Save to Google Docs");
    const without = vividVisionKeepBlock({ googleDocs: false });
    expect(without).not.toContain("Save to Google Docs");
    expect(without).toContain("no Google Doc option");
    expect(without).toContain("Download PDF");
    expect(without).toContain("Save to the One-Page Plan");
  });
});

describe("writesVividVision", () => {
  it("is true for the Vivid Vision Coach's prompt and false for another agent's", () => {
    expect(writesVividVision(readFileSync("prompts/practices/vivid-vision.md", "utf8"))).toBe(true);
    expect(writesVividVision(readFileSync("prompts/practices/role-description.md", "utf8"))).toBe(false);
  });
});
