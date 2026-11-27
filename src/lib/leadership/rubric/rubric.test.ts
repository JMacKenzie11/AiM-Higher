import { describe, it, expect } from "vitest";
import { RUBRIC, SUPPORTING_CHECKS, judgedChecks } from "./rubric";
import { findBannedPhrases } from "@/lib/voice/banned";

const checks = RUBRIC.flatMap((p) => p.checks);

describe("the rubric as checks", () => {
  it("has the rubric's ten parts, in its order", () => {
    expect(RUBRIC.map((p) => p.name)).toEqual([
      "Positive check-in",
      "Headlines",
      "Critical Success Factors and data",
      "Goals and priorities",
      "Operational commitments",
      "Generative dialogue",
      "Focus and decisions",
      "Meeting container",
      "Structure",
      "Engagement",
    ]);
  });

  it("gives every part at least one scored check at each level from 2 to 5", () => {
    for (const part of RUBRIC) {
      for (const level of [2, 3, 4, 5]) {
        const scored = part.checks.filter((c) => c.level === level && !SUPPORTING_CHECKS.has(c.id));
        expect(scored.length, `${part.key} level ${level}`).toBeGreaterThan(0);
      }
    }
  });

  it("has unique check ids, and every supporting check exists", () => {
    const ids = checks.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of SUPPORTING_CHECKS) expect(ids).toContain(id);
  });

  it("asks a question for every judged check", () => {
    for (const c of judgedChecks()) expect(c.question.trim().endsWith("?") || c.question.includes("Answer true")).toBe(true);
  });

  it("writes the team-facing wording to the copy rules", () => {
    for (const c of checks) {
      for (const text of [c.well, c.better]) {
        expect(text, c.id).not.toMatch(/[—–]/);
        expect(text, c.id).not.toMatch(/\b(he|she|him|her|his|hers|himself|herself)\b/i);
        expect(text, c.id).not.toMatch(/\bAI\b/);
        expect(findBannedPhrases(text), c.id).toEqual([]);
        // A step forward, never a fault.
        expect(text.toLowerCase(), c.id).not.toMatch(/\b(fail|failed|missed|weak|poor|didn't|did not|lacked)\b/);
      }
    }
  });
});
