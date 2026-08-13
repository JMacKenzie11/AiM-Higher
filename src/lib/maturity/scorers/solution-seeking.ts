import type { SupabaseClient } from "@supabase/supabase-js";
import { clampScore, type DisciplineScore } from "../types";
import type { FacilitationReview } from "@/lib/leadership/facilitation/types";

// Solution Seeking score — how well the team runs the AiMS 4Ws
// framework on issues surfaced in leadership meetings.
//
// The signal is already captured in the facilitation review as
// `fourws_audit[]` — one row per issue, with four booleans for
// has_what / has_want / has_way / has_who_when. We just aggregate
// closure across every issue in every reviewed meeting in the
// rolling 8-week window.
//
// Scoring:
//   - Total Ws closed / total Ws (issues × 4) → mapped to 0–10.
//     100% closure = 10; 50% closure = 5; 0% = 0.
// Rolling: as the 8-week window slides, older meetings drop off and
// the score reflects the recent past only.
//
// Only meaningful with meeting_facilitation_review enabled — the
// compute orchestrator won't call this scorer otherwise.

const WINDOW_WEEKS = 8;

type MeetingAnalysisRow = {
  meeting_id: string;
  facilitation_review_json: FacilitationReview | null;
  meetings: { created_at: string; company_id: string | null } | null;
};

export async function scoreSolutionSeeking(
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

  let totalIssues = 0;
  let totalWs = 0;
  let closedWs = 0;
  let hasWhat = 0;
  let hasWant = 0;
  let hasWay = 0;
  let hasWhoWhen = 0;

  for (const a of analyses) {
    const review = a.facilitation_review_json;
    if (!review || !Array.isArray(review.fourws_audit)) continue;
    for (const row of review.fourws_audit) {
      totalIssues += 1;
      totalWs += 4;
      if (row.has_what) {
        closedWs += 1;
        hasWhat += 1;
      }
      if (row.has_want) {
        closedWs += 1;
        hasWant += 1;
      }
      if (row.has_way) {
        closedWs += 1;
        hasWay += 1;
      }
      if (row.has_who_when) {
        closedWs += 1;
        hasWhoWhen += 1;
      }
    }
  }

  // No issues surfaced in the window ⇒ we can't score. Return null so
  // this discipline is dropped from the overall average instead of
  // reading as a zero. The evidence line explains why.
  if (totalIssues === 0) {
    return {
      key: "solution_seeking",
      score: null,
      breakdown: {
        windowWeeks: WINDOW_WEEKS,
        meetingsReviewed: analyses.length,
        issuesSurfaced: 0,
        closureRate: 0,
        hasWhat: 0,
        hasWant: 0,
        hasWay: 0,
        hasWhoWhen: 0,
      },
    };
  }

  const closureRate = closedWs / totalWs;

  return {
    key: "solution_seeking",
    score: clampScore(closureRate * 10),
    breakdown: {
      windowWeeks: WINDOW_WEEKS,
      meetingsReviewed: analyses.length,
      issuesSurfaced: totalIssues,
      closureRate: Math.round(closureRate * 100),
      hasWhat,
      hasWant,
      hasWay,
      hasWhoWhen,
    },
  };
}
