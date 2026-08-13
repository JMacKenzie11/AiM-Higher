import { describe, it, expect } from "vitest";
import { overallFrom } from "./compute";
import { clampScore } from "./types";
import type { DisciplineScore } from "./types";

// Pure-logic tests for the maturity math. The overall weighting rule
// is the load-bearing part — a bug here shifts every company's score
// on the dashboard. The individual scorers do DB reads and get their
// own tests where the chain is worth spelling out.

describe("clampScore", () => {
  it("clamps into [0, 10]", () => {
    expect(clampScore(-5)).toBe(0);
    expect(clampScore(15)).toBe(10);
    expect(clampScore(7.32)).toBe(7.3);
  });

  it("returns 0 for NaN so a divide-by-zero doesn't propagate", () => {
    expect(clampScore(NaN)).toBe(0);
  });
});

describe("overallFrom", () => {
  it("weighted-averages using the discipline weights (planning + execution = 2x, others 1x)", () => {
    // Weights from disciplines.ts:
    //   foundation 1, chart 1, planning 2, execution 2, measures 1, meetings 1 = 8
    // All at 5.0 → weighted sum 40 / 8 = 5.0
    const scores: DisciplineScore[] = [
      { key: "foundation", score: 5, breakdown: {} },
      { key: "chart", score: 5, breakdown: {} },
      { key: "planning", score: 5, breakdown: {} },
      { key: "execution", score: 5, breakdown: {} },
      { key: "measures", score: 5, breakdown: {} },
      { key: "meetings", score: 5, breakdown: {} },
    ];

    const overall = overallFrom(scores);

    expect(overall).toEqual({ score: 5, disciplinesCounted: 6 });
  });

  it("drops feature-gated disciplines that scored null — the weight is redistributed", () => {
    // measures + meetings off. Remaining weights: 1+1+2+2 = 6.
    // foundation=10, chart=10, planning=0, execution=0 →
    // (10+10+0+0) → weighted (10+10+0+0)/6 = 20/6 = 3.33
    const scores: DisciplineScore[] = [
      { key: "foundation", score: 10, breakdown: {} },
      { key: "chart", score: 10, breakdown: {} },
      { key: "planning", score: 0, breakdown: {} },
      { key: "execution", score: 0, breakdown: {} },
      { key: "measures", score: null, breakdown: { notEnabled: true } },
      { key: "meetings", score: null, breakdown: { notEnabled: true } },
    ];

    const overall = overallFrom(scores);

    expect(overall.disciplinesCounted).toBe(4);
    expect(overall.score).toBe(3.3);
  });

  it("returns { score: null } when every discipline is null (all features off)", () => {
    const scores: DisciplineScore[] = [
      { key: "foundation", score: null, breakdown: {} },
      { key: "chart", score: null, breakdown: {} },
    ];

    expect(overallFrom(scores)).toEqual({
      score: null,
      disciplinesCounted: 0,
    });
  });

  it("gives planning + execution 2x the pull compared to a 1x discipline", () => {
    // Only planning + foundation scored. Planning weight 2, foundation weight 1.
    // planning=10, foundation=0 → (10*2 + 0*1) / (2+1) = 20/3 ≈ 6.67
    const scores: DisciplineScore[] = [
      { key: "foundation", score: 0, breakdown: {} },
      { key: "planning", score: 10, breakdown: {} },
    ];

    expect(overallFrom(scores).score).toBe(6.7);
  });
});
