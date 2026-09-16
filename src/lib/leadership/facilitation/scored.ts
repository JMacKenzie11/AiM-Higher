import type { FacilitationReview } from "./types";

// Did this review actually score the meeting?
//
// A review that scored nothing is not a review, and the shape is
// specific enough to name: `insufficient_transcript` false — the
// model saying it had enough to work with — and no `overall`.
//
// HOW THAT HAPPENS. `dimensions` is in the tool schema's `required`
// list, and a model can still omit it. normalizeDimensionScore turns
// a missing dimension into `{ score: null, notes: "" }`, and
// `overall` falls back to the mean of whatever dimensions did score,
// which for "none of them" is null. Every step is individually
// forgiving and the result is a row that looks complete.
//
// SEEN IN PRODUCTION, meeting 4d235cd3 (2026-09-15). Rich executive
// summary, four dimensions each `{"score": null, "notes": ""}`, and
// `overall: null` with `insufficient_transcript: false`. Three
// surfaces then disagreed about whether a review existed: the
// meetings list showed an empty Facilitation cell, the detail page
// rendered "How the meeting was run" with dashes where the scores
// go, and the database held a row that read as present.
//
// Used in two places on purpose. The analyzer refuses to persist an
// unscored review, which stops new ones; the detail page refuses to
// render one, which handles the rows already stored without needing
// them re-analysed.
export function isScoredReview(
  review: Pick<FacilitationReview, "insufficient_transcript" | "overall">
): boolean {
  // Deliberately unscored is a real answer, and the card says so.
  if (review.insufficient_transcript) return true;
  return review.overall !== null;
}
