import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { loadCoachingPrinciples } from "./principles";

// prompts/aims-coaching-principles.md is Jason's text, word for word
// (2026-09-30). It decides how Aimee coaches in every conversation, so
// an edit to it is a deliberate act: regenerate this with
//   shasum -a 256 prompts/aims-coaching-principles.md
// and say why beside it.
const PRINCIPLES_SHA = "9c54c381dd2b18d88197c4e34e291f265801ac8b605cf30159f1f73dd34d5b12";

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
    expect(route).toMatch(/\$\{composed\}\\n\\n\$\{await loadCoachingPrinciples\(\)\}\\n\\n\$\{VOICE_RULES_COACH\}/);
    const card = readFileSync("src/lib/guide/headline.ts", "utf8");
    expect(card).toMatch(/text: `\$\{SYSTEM\}\\n\\n\$\{principles\}`/);
  });
});
