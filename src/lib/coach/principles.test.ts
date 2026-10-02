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
const PRINCIPLES_SHA = "7e9f6ba068f50491b00da6dd4d1e04ba6f3d4d3ba6a8a092a749db605a341c13";

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
