import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { loadCoachingPrinciples } from "./principles";

// prompts/aims-coaching-principles.md is Jason's text, word for word
// (2026-09-30). It decides how Aimee coaches in every conversation, so
// an edit to it is a deliberate act: regenerate this with
//   shasum -a 256 prompts/aims-coaching-principles.md
// and say why beside it.
//
// 2026-10-02 (Jason approved, from the principles comparison): grading
// covers plans and questions too, a list of options counts as more than
// one question, and a serious risk is named in one or two sentences.
//
// 2026-10-02, later: "Reflect without grading" gains one example, saying
// the chosen step back. The wording above alone left "Good move" in 6 of
// 6 next-step replies; with the example, none in 8.
//
// 2026-10-03: "Coach about someone else with care", the rules for a
// conversation about another person (open data decisions, 2026-10-01):
// prepare to act, no ranking or comparing, no case-building, no guessing
// at health, personal life or motives, and fit the relationship. The
// Coach button opening to everyone in a company waits on it (phase E).
const PRINCIPLES_SHA = "53238dab381572bc7e2c31e6a62a0e80416dc706e05e1a35a9c0ad4ef6cd828e";

describe("the AiMS coaching principles", () => {
  it("are Jason's text, unchanged", () => {
    const raw = readFileSync("prompts/aims-coaching-principles.md", "utf8");
    expect(createHash("sha256").update(raw).digest("hex")).toBe(PRINCIPLES_SHA);
  });

  it("load as the file's text", async () => {
    const text = await loadCoachingPrinciples();
    expect(text.startsWith("# AiMS coaching principles")).toBe(true);
    expect(text).toContain("## Name a serious risk plainly");
  });

  // Every Aimee conversation and the invitations she writes: the chat
  // route builds every conversation's system prompt, the card has its own.
  it("reach every conversation and every invitation", () => {
    const route = readFileSync("src/app/api/coach/route.ts", "utf8");
    expect(route).toMatch(/\$\{composed\}\\n\\n\$\{await loadCoachingPrinciples\(\)\}\\n\\n\$\{COMMITMENT_DRAFT_BLOCK\}\\n\\n\$\{VOICE_RULES_COACH\}/);
    const card = readFileSync("src/lib/guide/headline.ts", "utf8");
    expect(card).toMatch(/text: `\$\{SYSTEM\}\\n\\n\$\{principles\}`/);
  });
});
