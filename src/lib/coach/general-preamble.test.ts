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

  // Jason, 2026-11-13: a B&B leader asked about staff who are not in
  // AiMS and got a company figure first, then a name from memory.
  it("keep the record to the people it covers (Jason, 2026-11-13)", () => {
    expect(GENERAL_MODE_PREAMBLE).toMatch(/Your first reply is about what they said, never a figure/);
    expect(GENERAL_MODE_PREAMBLE).toMatch(/never answered with anyone else's figures/);
    expect(GENERAL_MODE_PREAMBLE).toMatch(/say whose it is/);
    expect(GENERAL_MODE_PREAMBLE).toMatch(/The record is never a reason to go and fetch a figure/);
  });

  it("offer the lookup once instead of asking them to sort the question", () => {
    expect(GENERAL_MODE_PREAMBLE).toContain("If they're in AiMS, tell me who and I can look at how their commitments have gone.");
    expect(GENERAL_MODE_PREAMBLE).toMatch(/Do not ask them to sort their question into a kind before you help/);
  });

  it("stop looking things up once told the person is not in AiMS", () => {
    expect(GENERAL_MODE_PREAMBLE).toMatch(/not in AiMS, or works outside the company, use no figures and look nobody up for the rest of the conversation/);
  });

  it("ask about a name from memory, never assume it", () => {
    expect(GENERAL_MODE_PREAMBLE).toMatch(/A name from your notes on earlier conversations is a guess about who they mean, never a fact/);
    expect(GENERAL_MODE_PREAMBLE).toContain("Is this about Sam again?");
  });
});
