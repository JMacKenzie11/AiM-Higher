import { describe, it, expect } from "vitest";
import { computeOverall, overallForRow, SCORE_WEIGHTS } from "./score";

describe("SCORE_WEIGHTS", () => {
  it("sums to 100", () => {
    expect(Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });
});

describe("computeOverall", () => {
  // Jason's worked example: (6 x 0.30) + (7 x 0.25) + (6 x 0.25) + (10 x 0.20) = 7.05.
  it("matches the worked example, with agenda 5/5 scaled to 10", () => {
    const s = computeOverall({ accountability: 6, rhythm: 7, alignment: 6, agenda: 5 })!;
    expect(s.hundredths).toBe(705);
    expect(s.oneDecimal).toBe("7.1");
    expect(s.rounded).toBe(7);
    expect(s.lines.find((l) => l.key === "agenda")).toMatchObject({ raw: 5, outOf: 5, scaled: 10 });
  });

  it("rounds half up at both precisions, without floating point drift", () => {
    // 5*30 + 7*25 + 7*25 + (4*2)*20 = 150 + 175 + 175 + 160 = 660 -> 6.60.
    expect(computeOverall({ accountability: 5, rhythm: 7, alignment: 7, agenda: 4 })).toMatchObject({
      hundredths: 660,
      oneDecimal: "6.6",
      rounded: 7,
    });
    // 5*30 + 6*25 + 7*25 + (3*2)*20 = 150 + 150 + 175 + 120 = 595 -> 5.95:
    // one decimal rounds up to 6.0, the strip to 6.
    expect(computeOverall({ accountability: 5, rhythm: 6, alignment: 7, agenda: 3 })).toMatchObject({
      hundredths: 595,
      oneDecimal: "6.0",
      rounded: 6,
    });
    // 6*30 + 6*25 + 7*25 + (2*2)*20 = 180 + 150 + 175 + 80 = 585 -> 5.85:
    // 5.9 at one decimal, and 6 on the strip because 5.85 rounds up.
    expect(computeOverall({ accountability: 6, rhythm: 6, alignment: 7, agenda: 2 })).toMatchObject({
      hundredths: 585,
      oneDecimal: "5.9",
      rounded: 6,
    });
  });

  it("scores a perfect and an empty meeting at the ends of the scale", () => {
    expect(computeOverall({ accountability: 10, rhythm: 10, alignment: 10, agenda: 5 })).toMatchObject({
      hundredths: 1000,
      oneDecimal: "10.0",
      rounded: 10,
    });
    expect(computeOverall({ accountability: 0, rhythm: 0, alignment: 0, agenda: 0 })).toMatchObject({
      hundredths: 0,
      oneDecimal: "0.0",
      rounded: 0,
    });
  });

  it("gives no overall when any part is missing", () => {
    // The E13 case: a review with an agenda score and no dimensions
    // block must stay unscored, so its one retry fires.
    expect(computeOverall({ accountability: null, rhythm: null, alignment: null, agenda: 3 })).toBeNull();
    expect(computeOverall({ accountability: 6, rhythm: 7, alignment: 6, agenda: null })).toBeNull();
  });

  it("returns null when nothing was scored", () => {
    expect(computeOverall({ accountability: null, rhythm: null, alignment: null, agenda: null })).toBeNull();
  });

  it("clamps out-of-range parts rather than trusting them", () => {
    const s = computeOverall({ accountability: 14, rhythm: 7, alignment: 6, agenda: 9 })!;
    expect(s.lines.find((l) => l.key === "accountability")!.raw).toBe(10);
    expect(s.lines.find((l) => l.key === "agenda")!.raw).toBe(5);
  });

  it("takes other weights without touching anything else", () => {
    const s = computeOverall(
      { accountability: 6, rhythm: 7, alignment: 6, agenda: 5 },
      { accountability: 25, rhythm: 25, alignment: 25, agenda: 25 }
    )!;
    // (6 + 7 + 6 + 10) / 4 = 7.25
    expect(s.hundredths).toBe(725);
    expect(s.oneDecimal).toBe("7.3");
    expect(s.rounded).toBe(7);
  });
});

describe("overallForRow", () => {
  const review = {
    insufficient_transcript: false,
    dimensions: { rhythm: { score: 7 }, accountability: { score: 6 }, alignment: { score: 6 } },
    agenda_adherence: { score_out_of_5: 5 },
  };

  it("uses a row's own stored parts and weights", () => {
    const out = overallForRow(
      {
        score_rhythm: 7, score_accountability: 6, score_alignment: 6, score_agenda: 5,
        score_weights: { accountability: 25, rhythm: 25, alignment: 25, agenda: 25 },
      },
      review
    )!;
    expect(out.weightsFrom).toBe("stored");
    expect(out.score.hundredths).toBe(725);
  });

  it("computes an older row from its review parts with today's weights, never its judged overall", () => {
    const out = overallForRow({}, { ...review, overall: 9 } as typeof review)!;
    expect(out.weightsFrom).toBe("current");
    expect(out.score.hundredths).toBe(705);
  });

  it("has nothing to say about an insufficient transcript", () => {
    expect(overallForRow(null, { ...review, insufficient_transcript: true })).toBeNull();
  });
});
