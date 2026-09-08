import { describe, it, expect } from "vitest";
import { compareOverall, overallFrom } from "./compute";
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

describe("compareOverall", () => {
  const d = (key: string, score: number | null): DisciplineScore =>
    ({ key, score, breakdown: {} }) as DisciplineScore;

  it("compares like for like when both points cover the same disciplines", () => {
    const then = [d("foundation", 4), d("chart", 6)];
    const now = [d("foundation", 8), d("chart", 6)];

    expect(compareOverall(then, now)).toEqual({
      then: 5,
      now: 7,
      delta: 2,
      disciplinesCompared: 2,
    });
  });

  it("drops a discipline only one side scored", () => {
    // The shape that put false alerts on Guide HQ: the stored
    // snapshot never scored `measures`, the live score does, and a
    // low `measures` drags the live mean below a snapshot mean that
    // never included it.
    //
    // Both sides here are 8 on what they share, so the honest answer
    // is flat — even though the raw overalls are 8 and 6.
    const then = [d("foundation", 8), d("chart", 8), d("measures", null)];
    const now = [d("foundation", 8), d("chart", 8), d("measures", 2)];

    const result = compareOverall(then, now);

    expect(result).toEqual({
      then: 8,
      now: 8,
      delta: 0,
      disciplinesCompared: 2,
    });
    // The unrestricted arithmetic this replaces, for contrast.
    expect(overallFrom(now).score).toBe(6);
  });

  it("is symmetric about which side is missing the discipline", () => {
    const then = [d("foundation", 8), d("measures", 2)];
    const now = [d("foundation", 8), d("measures", null)];

    expect(compareOverall(then, now)?.delta).toBe(0);
  });

  it("keeps the discipline weights on the restricted set", () => {
    // planning weight 2, foundation weight 1. Shared = both.
    // then: (2*2 + 8*1)/3 = 4.  now: (8*2 + 8*1)/3 = 8.
    const then = [d("planning", 2), d("foundation", 8), d("meetings", null)];
    const now = [d("planning", 8), d("foundation", 8), d("meetings", 3)];

    expect(compareOverall(then, now)).toMatchObject({
      then: 4,
      now: 8,
      delta: 4,
      disciplinesCompared: 2,
    });
  });

  it("reports a real decline rather than flattening everything", () => {
    const then = [d("foundation", 9), d("chart", 9)];
    const now = [d("foundation", 3), d("chart", 3)];

    expect(compareOverall(then, now)?.delta).toBe(-6);
  });

  it("returns null when the two points share no scored discipline", () => {
    expect(compareOverall([d("foundation", 8)], [d("measures", 8)])).toBeNull();
  });

  it("returns null when either side scored nothing at all", () => {
    expect(compareOverall([], [d("foundation", 8)])).toBeNull();
    expect(compareOverall([d("foundation", 8)], [])).toBeNull();
    expect(
      compareOverall([d("foundation", null)], [d("foundation", 8)])
    ).toBeNull();
  });
});
