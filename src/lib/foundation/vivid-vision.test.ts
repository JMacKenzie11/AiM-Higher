import { describe, expect, it } from "vitest";
import { parseVividVision, splitBold, visionYear, vividVisionInMessage, VIVID_VISION_MAX } from "./vivid-vision";
import { PLAIN_VISION, STRUCTURED_VISION } from "./vivid-vision.fixture";
import { OUTPUT_CARD_BY_TAG } from "@/lib/practices/output-cards";
import { readFileSync } from "node:fs";

const DOC = "Acme in 2036\nBuilt to last\n\nWe wake up every day...\n\nProof Points\n- One";

describe("the vivid vision block", () => {
  it("splits the headline from the rest, and keeps the whole text as saved", () => {
    const v = parseVividVision(`\n${DOC}\n`)!;
    expect(v.title).toBe("Acme in 2036");
    expect(v.doc.tagline).toBe("Built to last");
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

  it("reads a plain block written before the structure, and saves it as written", () => {
    const v = parseVividVision(PLAIN_VISION)!;
    expect(v.text).toBe(PLAIN_VISION);
    expect(v.doc.intro).toEqual(["We wake up every day..."]);
    expect(v.doc.proof.groups).toEqual([{ name: null, items: ["One", "Two"] }]);
    expect(v.doc.protect.items).toEqual(["Care"]);
    expect(v.doc.themes.items).toEqual([{ name: "Grow", subtitle: null, body: [] }]);
  });

  describe("a structured block", () => {
    const v = parseVividVision(STRUCTURED_VISION)!;

    it("reads the title, tagline and story", () => {
      expect(v.title).toBe("Built to Be Called");
      expect(v.doc.tagline).toBe("The firm builders call when it matters.");
      expect(v.doc.intro).toHaveLength(1);
      expect(v.doc.story.map((s) => s.headline)).toEqual(["Calm on Every Site", "Leaders From the Crew", "Three Offices, One Standard"]);
      expect(v.doc.story[1].paragraphs[0]).toContain("\nPeople stay");
    });

    it("reads each section's heading after the colon", () => {
      expect(v.doc.proof.heading).toBe("What 2036 Looks Like");
      expect(v.doc.protect.heading).toBe("Five Things That Don't Change");
      expect(v.doc.themes.heading).toBe("Where We Put Our Energy");
    });

    it("groups the proof points, and gives each theme its subtitle", () => {
      expect(v.doc.proof.groups.map((g) => [g.name, g.items.length])).toEqual([["Clients", 2], ["Team", 2]]);
      expect(v.doc.protect.items).toHaveLength(5);
      expect(v.doc.themes.items[0]).toEqual({
        name: "Grow Leaders",
        subtitle: "Every crew lead ready to run an office.",
        body: ["Build the path from apprentice to office lead, and walk people along it."],
      });
      expect(v.doc.closing).toEqual(["Calm on site. Leaders from the crew. The call that matters."]);
    });

    it("saves the summary to the One-Page Plan, and keeps it out of the document", () => {
      expect(v.doc.summary).toHaveLength(1);
      expect(v.saveText).toBe(
        "Built to Be Called\nThe firm builders call when it matters.\n\nIt's 2036. Harbour Build is the firm builders call when a job goes wrong, calm on every site and led by people who came up from the crew.\nThree offices run one standard, and the owner can step away."
      );
      expect(v.text).not.toContain("Three offices run one standard, and the owner");
      expect(v.doc.closing).toHaveLength(1);
    });

    it("saves the whole document when there is no summary", () => {
      const noSummary = parseVividVision(STRUCTURED_VISION.split("\n## One-Page Plan Summary")[0])!;
      expect(noSummary.saveText).toBe(noSummary.text);
      expect(parseVividVision(PLAIN_VISION)!.saveText).toBe(PLAIN_VISION);
    });

    it("saves plain text, with no markers for the Vision card to show", () => {
      expect(v.text.startsWith("Built to Be Called\nThe firm builders call when it matters.\n")).toBe(true);
      expect(v.text).not.toMatch(/\*\*|^#/m);
      expect(v.text).toContain("\nCalm on Every Site\nWalk onto any Harbour site");
      expect(v.text).toContain("\nProof Points\nClients\n- Clients renew without a pitch, year after year");
      expect(v.text).toContain("- Grow Leaders: Every crew lead ready to run an office.");
    });
  });

  it("splits bold runs", () => {
    expect(splitBold("a **b** c")).toEqual([
      { text: "a ", bold: false },
      { text: "b", bold: true },
      { text: " c", bold: false },
    ]);
  });

  it("dates the vision ten years on from when it was written", () => {
    expect(visionYear("2026-11-02T10:00:00Z")).toBe(2036);
  });
});
