import { describe, expect, it } from "vitest";
import { parseVividVision, vividVisionInMessage, VIVID_VISION_MAX } from "./vivid-vision";
import { OUTPUT_CARD_BY_TAG } from "@/lib/practices/output-cards";
import { readFileSync } from "node:fs";

const DOC = "Acme in 2036\nBuilt to last\n\nWe wake up every day...\n\nProof Points\n- One";

describe("the vivid vision block", () => {
  it("splits the headline from the rest, and keeps the whole text as saved", () => {
    const v = parseVividVision(`\n${DOC}\n`)!;
    expect(v.title).toBe("Acme in 2036");
    expect(v.rest.startsWith("Built to last")).toBe(true);
    expect(v.text).toBe(DOC);
  });

  it("drops bold markers the model puts on the headline", () => {
    expect(parseVividVision("**Acme in 2036**\nTagline")!.title).toBe("Acme in 2036");
  });

  it("is nothing while nothing has arrived", () => {
    expect(parseVividVision("  \n ")).toBeNull();
  });

  it("caps a runaway reply", () => {
    expect(parseVividVision("x".repeat(VIVID_VISION_MAX + 50))!.text.length).toBe(VIVID_VISION_MAX);
  });

  it("is read from the saved message, the last block winning", () => {
    const msg = "Here it is.\n\n```vivid_vision\nFirst\n```\n\nAnd again.\n\n```vivid_vision\n" + DOC + "\n```\n\n1. What gives you energy?";
    expect(vividVisionInMessage(msg)!.text).toBe(DOC);
    expect(vividVisionInMessage("no block here")).toBeNull();
  });

  it("has a card, and the agent's prompt writes its tag", () => {
    expect(OUTPUT_CARD_BY_TAG.vivid_vision).toBe("VividVisionCard");
    const prompt = readFileSync("prompts/practices/vivid-vision.md", "utf8");
    expect(prompt).toContain("```vivid_vision");
    expect(prompt).toContain("get_foundation");
  });
});
