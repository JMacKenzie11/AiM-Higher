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

export type ScorePartKey = "accountability" | "rhythm" | "alignment" | "agenda";

// Percent, summing to 100. Jason's proposal, 2026-09-25, pending his
// confirmation. Positive framing is judged and stored but is not in
// the overall.
export const SCORE_WEIGHTS: Readonly<Record<ScorePartKey, number>> = {
  accountability: 30,
  rhythm: 25,
  alignment: 25,
  agenda: 20,
};

export const SCORE_PART_LABELS: Readonly<Record<ScorePartKey, string>> = {
  accountability: "Accountability",
  rhythm: "Rhythm",
  alignment: "Alignment",
  agenda: "Agenda sections",
};

// Display order, heaviest first.
export const SCORE_PART_ORDER: readonly ScorePartKey[] = [
  "accountability",
  "rhythm",
  "alignment",
  "agenda",
];

export type ScoreParts = {
  rhythm: number | null; // 0 to 10
  accountability: number | null; // 0 to 10
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
  // ALL FOUR, OR NO OVERALL. A missing part is the model not
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

// The overall for a stored row, from wherever its parts live.
//
// A row written since migration 0236 carries its parts and the
// weights that were used, and those win: its score is reproducible
// from itself and does not move when SCORE_WEIGHTS changes.
//
// An older row has only the review JSON. Its parts are there, so the
// overall is computed from them with today's weights, on read. It is
// NOT the model's judged `overall` stored in that JSON, which never
// derived from the parts and would disagree with the expander beside
// it. Nothing is written back.
export function overallForRow(
  row: {
    score_rhythm?: number | null;
    score_accountability?: number | null;
    score_alignment?: number | null;
    score_agenda?: number | null;
    score_weights?: unknown;
  } | null,
  review: {
    insufficient_transcript: boolean;
    dimensions: {
      rhythm: { score: number | null };
      accountability: { score: number | null };
      alignment: { score: number | null };
    };
    agenda_adherence: { score_out_of_5: number | null };
  } | null
): { score: OverallScore; weightsFrom: "stored" | "current" } | null {
  if (review?.insufficient_transcript) return null;
  const stored = storedWeights(row?.score_weights);
  if (row && stored && row.score_rhythm != null) {
    const score = computeOverall(
      {
        rhythm: row.score_rhythm ?? null,
        accountability: row.score_accountability ?? null,
        alignment: row.score_alignment ?? null,
        agenda: row.score_agenda ?? null,
      },
      stored
    );
    if (score) return { score, weightsFrom: "stored" };
  }
  if (!review) return null;
  const score = computeOverall({
    rhythm: review.dimensions.rhythm.score,
    accountability: review.dimensions.accountability.score,
    alignment: review.dimensions.alignment.score,
    agenda: review.agenda_adherence.score_out_of_5,
  });
  return score ? { score, weightsFrom: "current" } : null;
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
