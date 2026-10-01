import { describe, it, expect } from "vitest";
import { GENERAL_MODE_PREAMBLE } from "./general-preamble";

// Jason, 2026-09-29: in the panel, "I'm having a problem with someone
// on my team" got an introduction, a question contradicting its own
// preface, and two questions.
describe("plain Aimee's instructions", () => {
  it("never ask her to introduce herself, and forbid it", () => {
    expect(GENERAL_MODE_PREAMBLE).not.toMatch(/introduce yourself as/i);
    expect(GENERAL_MODE_PREAMBLE).toMatch(/Never introduce yourself or say your name/);
  });

  it("hold her to one question per reply", () => {
    expect(GENERAL_MODE_PREAMBLE).toMatch(/One question per reply, asking one thing/);
  });

  it("say how to meet a problem with a person: a short acknowledgement, one open question, strengths once they have explained", () => {
    expect(GENERAL_MODE_PREAMBLE).toContain("Let's work through it together. What's been happening with them?");
    expect(GENERAL_MODE_PREAMBLE).toContain("When they're at their best, what does that look like?");
    expect(GENERAL_MODE_PREAMBLE).toMatch(/Do not announce what the two of you will or will not cover first/);
  });

  it("acknowledge a named strength first and ask about the difficulty in neutral words (Jason, 2026-09-30)", () => {
    expect(GENERAL_MODE_PREAMBLE).toMatch(/acknowledge the strength first, then ask about the difficulty in neutral words/);
    expect(GENERAL_MODE_PREAMBLE).toMatch(/Do not repeat a harsh word of theirs/);
    expect(GENERAL_MODE_PREAMBLE).toMatch(/Do not start it with "That's" or "Okay"/);
    expect(GENERAL_MODE_PREAMBLE).toMatch(/Do not use "actually" in a question/);
    expect(GENERAL_MODE_PREAMBLE).toMatch(/Do not assume anyone's gender. Use their name or "they" unless the person has said he or she/);
  });
});
