import { describe, it, expect } from "vitest";
import { isScoredReview } from "./scored";

// The rule that stops three surfaces disagreeing about whether a
// facilitation review exists.
//
// THE INCIDENT, meeting 4d235cd3 (2026-09-15, production). The model
// returned a rich executive summary and no `dimensions` object.
// normalizeDimensionScore turned each missing dimension into
// `{ score: null, notes: "" }`, and `overall` fell back to the mean
// of the dimensions that scored — none — so it came out null with
// `insufficient_transcript` still false. The row read as present.
// The meetings list showed an empty Facilitation cell, and the
// detail page rendered "How the meeting was run" with a dash in
// every score chip.

const base = { insufficient_transcript: false, overall: null as number | null };

describe("isScoredReview", () => {
  it("accepts a review with an overall score", () => {
    expect(isScoredReview({ ...base, overall: 6 })).toBe(true);
  });

  it("accepts a zero, which is a score like any other", () => {
    // The bug this guards against is a NULL, not a low number. A
    // meeting can genuinely score 0 and must still show its review.
    expect(isScoredReview({ ...base, overall: 0 })).toBe(true);
  });

  it("rejects a review that scored nothing", () => {
    // THE SPECIMEN. insufficient_transcript false means the model
    // said it had enough to work with, so a null overall is the
    // model contradicting itself rather than declining.
    expect(isScoredReview(base)).toBe(false);
  });

  it("accepts a deliberately unscored review", () => {
    // insufficient_transcript is a real answer with its own card
    // copy, and it is the one case where null scores are correct.
    expect(
      isScoredReview({ insufficient_transcript: true, overall: null })
    ).toBe(true);
  });

  it("accepts an insufficient review even if a score leaked through", () => {
    // Not a shape the normalizer produces, but the rule should not
    // depend on the normalizer being correct: declining is declining.
    expect(
      isScoredReview({ insufficient_transcript: true, overall: 4 })
    ).toBe(true);
  });
});
