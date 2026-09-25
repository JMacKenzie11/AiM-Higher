// THE OVERALL SCORE IS ARITHMETIC, NOT A JUDGEMENT.
//
// It used to be a separate model judgement, "an integrated read, not
// a mean", which is why it never derived from the four parts shown
// beside it. A reader could see Rhythm 7, Accountability 6, Alignment
// 6, Agenda 5/5 and an overall that none of those explained.
//
// The model still judges the four parts. The overall is computed
// here, from them, with weights that live in this one constant so a
// change of weighting never touches the prompt.
//
// ---- WHOLE NUMBERS, ON PURPOSE ----------------------------------
//
// Parts are integers and weights are whole percentages, so the
// weighted sum is computed as an integer in hundredths. 7.05 is 705,
// exactly. Floating point would make it 7.0499999 on some inputs and
// round the one-decimal display down to 7.0.

export type ScorePartKey =
  | "positive_framing"
  | "accountability"
  | "rhythm"
  | "alignment"
  | "agenda";

// Percent, summing to 100. Jason's weights, 2026-09-25. Positive
// framing is a scored part and carries the joint-heaviest weight.
export const SCORE_WEIGHTS: Readonly<Record<ScorePartKey, number>> = {
  positive_framing: 25,
  accountability: 25,
  rhythm: 20,
  alignment: 15,
  agenda: 15,
};

// THE CUTOVER. Meetings analysed from this moment are scored by
// SCORE_WEIGHTS; every meeting before it keeps the score it was given
// at the time (the model's judged overall), on the meeting page and on
// the scorecard alike. History is not rewritten, and nothing older is
// back-computed on read.
//
// Safe to set before the code ships, because the formula also needs
// the row's own stored parts (migration 0236): a meeting analysed
// after this date by code that did not store them still keeps its
// original score. See scoreForRow.
export const SCORE_CUTOVER_ISO = "2026-09-25T00:00:00Z";

export const SCORE_PART_LABELS: Readonly<Record<ScorePartKey, string>> = {
  positive_framing: "Positive framing",
  accountability: "Accountability",
  rhythm: "Rhythm",
  alignment: "Alignment",
  agenda: "Agenda sections",
};

// Display order, heaviest first.
export const SCORE_PART_ORDER: readonly ScorePartKey[] = [
  "positive_framing",
  "accountability",
  "rhythm",
  "alignment",
  "agenda",
];

export type ScoreParts = {
  positive_framing: number | null; // 0 to 10
  accountability: number | null; // 0 to 10
  rhythm: number | null; // 0 to 10
  alignment: number | null; // 0 to 10
  agenda: number | null; // 0 to 5, scaled to 10 before weighting
};

export type ScoreLine = {
  key: ScorePartKey;
  label: string;
  // As judged, on its own scale: out of 10, or out of 5 for agenda.
  raw: number;
  outOf: 5 | 10;
  // On the 10-point scale the weighting uses.
  scaled: number;
  weight: number; // percent
};

export type OverallScore = {
  lines: ScoreLine[];
  // Exact, in hundredths: 705 means 7.05.
  hundredths: number;
  // 7.1: shown in the "How this is scored" expander.
  oneDecimal: string;
  // 7: shown on the strip.
  rounded: number;
};

// Half rounds up, in integers: 705 / 10 is 70.5, which becomes 71.
function roundDiv(n: number, d: number): number {
  return Math.floor((2 * n + d) / (2 * d));
}

export function computeOverall(
  parts: ScoreParts,
  weights: Readonly<Record<ScorePartKey, number>> = SCORE_WEIGHTS
): OverallScore | null {
  // EVERY PART, OR NO OVERALL. A missing part is the model not
  // answering (failure mode E13), and the review's one retry keys on
  // there being no overall. Sharing the weight out across whatever
  // was scored would turn "the dimensions block never arrived" into a
  // confident 6 built from the agenda score alone.
  const lines: ScoreLine[] = [];
  for (const key of SCORE_PART_ORDER) {
    const raw = parts[key];
    if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
    const outOf = key === "agenda" ? 5 : 10;
    const clamped = Math.max(0, Math.min(outOf, Math.round(raw)));
    lines.push({
      key,
      label: SCORE_PART_LABELS[key],
      raw: clamped,
      outOf,
      scaled: key === "agenda" ? clamped * 2 : clamped,
      weight: weights[key],
    });
  }
  const weightTotal = lines.reduce((sum, l) => sum + l.weight, 0);
  if (weightTotal <= 0) return null;
  // sum(scaled * weight) is in "points x percent"; with weights that
  // sum to 100 it IS the score in hundredths, exactly.
  const hundredths = roundDiv(
    lines.reduce((sum, l) => sum + l.scaled * l.weight, 0) * 100,
    weightTotal
  );
  const tenths = roundDiv(hundredths, 10);
  return {
    lines,
    hundredths,
    oneDecimal: `${Math.floor(tenths / 10)}.${tenths % 10}`,
    rounded: roundDiv(hundredths, 100),
  };
}

// WHICH SCORE A STORED MEETING SHOWS. One rule, used by the meeting
// page, the meetings list and the scorecard, so they never disagree.
//
//   computed  analysed at or after SCORE_CUTOVER_ISO AND carrying its
//             own stored parts and weights (0236). Reproducible from
//             the row, and unmoved by a later change of weights.
//   original  everything else: the review's own `overall`, exactly as
//             it was given. Never recomputed from its parts.
export type MeetingScore =
  | { kind: "computed"; score: OverallScore; value: number }
  | { kind: "original"; value: number };

export type StoredScoreRow = {
  created_at?: string | null;
  score_positive_framing?: number | null;
  score_rhythm?: number | null;
  score_accountability?: number | null;
  score_alignment?: number | null;
  score_agenda?: number | null;
  score_weights?: unknown;
};

export function scoreForRow(
  row: StoredScoreRow | null,
  review: { insufficient_transcript: boolean; overall: number | null } | null
): MeetingScore | null {
  if (!review || review.insufficient_transcript) return null;
  const weights = storedWeights(row?.score_weights);
  const analysedAt = row?.created_at ? Date.parse(row.created_at) : NaN;
  if (row && analysedAt >= Date.parse(SCORE_CUTOVER_ISO) && weights) {
    const score = computeOverall(
      {
        positive_framing: row.score_positive_framing ?? null,
        accountability: row.score_accountability ?? null,
        rhythm: row.score_rhythm ?? null,
        alignment: row.score_alignment ?? null,
        agenda: row.score_agenda ?? null,
      },
      weights
    );
    if (score) return { kind: "computed", score, value: score.hundredths / 100 };
  }
  return typeof review.overall === "number"
    ? { kind: "original", value: review.overall }
    : null;
}

function storedWeights(raw: unknown): Record<ScorePartKey, number> | null {
  if (!raw || typeof raw !== "object") return null;
  const w = raw as Record<string, unknown>;
  const out = {} as Record<ScorePartKey, number>;
  for (const key of SCORE_PART_ORDER) {
    if (typeof w[key] !== "number") return null;
    out[key] = w[key] as number;
  }
  return out;
}
