import type { SupabaseClient } from "@supabase/supabase-js";
import { clampScore, type DisciplineScore } from "../types";
import type { FacilitationReview } from "@/lib/leadership/facilitation/types";

// Positive Framing (Appreciative Practice) score — the appreciative-
// inquiry signal from the meeting quality analyst. Only meaningful
// when meeting_facilitation_review is enabled and the review has
// been re-run against the v2 prompt (v1 rows have no
// positive_framing dimension).
//
// Scoring: mean of the `positive_framing` dimension across reviewed
// meetings in the rolling 8-week window. When zero reviewed meetings
// have a positive_framing score (i.e. everything is still v1), the
// score is null so the discipline is dropped from the overall
// average rather than reading as a zero.
//
// Breakdown also exposes running totals of appreciation_moments /
// generative_questions / reframes across the window so the card can
// show "12 appreciations, 8 generative questions, 3 reframes across
// 6 meetings" — the qualitative "what's actually happening" behind
// the number.

const WINDOW_WEEKS = 8;

type MeetingAnalysisRow = {
  meeting_id: string;
  facilitation_review_json: FacilitationReview | null;
  meetings: { created_at: string; company_id: string | null } | null;
};

export async function scorePositiveFraming(
  admin: SupabaseClient,
  companyId: string
): Promise<DisciplineScore> {
  const cutoffMs = Date.now() - WINDOW_WEEKS * 7 * 24 * 60 * 60 * 1000;
  const cutoffIso = new Date(cutoffMs).toISOString();

  const { data: rows } = await admin
    .from("meeting_analyses")
    .select(
      "meeting_id, facilitation_review_json, meetings!inner(created_at, company_id)"
    )
    .eq("meetings.company_id", companyId)
    .gte("meetings.created_at", cutoffIso);

  const analyses = (rows ?? []) as unknown as MeetingAnalysisRow[];

  const framingScores: number[] = [];
  let appreciationCount = 0;
  let generativeCount = 0;
  let reframeCount = 0;

  for (const a of analyses) {
    const review = a.facilitation_review_json;
    if (!review) continue;
    const dim = review.dimensions?.positive_framing;
    if (dim && typeof dim.score === "number") {
      framingScores.push(dim.score);
    }
    appreciationCount += review.appreciation_moments?.length ?? 0;
    generativeCount += review.generative_questions?.length ?? 0;
    reframeCount += review.reframes?.length ?? 0;
  }

  if (framingScores.length === 0) {
    return {
      key: "positive_framing",
      score: null,
      breakdown: {
        windowWeeks: WINDOW_WEEKS,
        meetingsReviewed: analyses.length,
        reviewsWithFraming: 0,
        appreciationCount,
        generativeCount,
        reframeCount,
        meanFraming: 0,
      },
    };
  }

  const meanFraming =
    framingScores.reduce((a, b) => a + b, 0) / framingScores.length;

  return {
    key: "positive_framing",
    score: clampScore(meanFraming),
    breakdown: {
      windowWeeks: WINDOW_WEEKS,
      meetingsReviewed: analyses.length,
      reviewsWithFraming: framingScores.length,
      appreciationCount,
      generativeCount,
      reframeCount,
      meanFraming: Math.round(meanFraming * 10) / 10,
    },
  };
}
