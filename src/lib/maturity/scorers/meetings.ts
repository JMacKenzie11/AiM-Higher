import type { SupabaseClient } from "@supabase/supabase-js";
import { clampScore, type DisciplineScore } from "../types";
import type { FacilitationReview } from "@/lib/leadership/facilitation/types";

// Meetings score. Only computed when the company has
// meeting_facilitation_review on (the review provides the quality
// signal). Rolling 8-week window.
//
//   - Cadence: distinct weeks in the last 8 that had ≥1 meeting
//              8/8 → 5 pts (weekly rhythm), 4/8 → 2.5, 0/8 → 0
//   - Quality: mean of the review `overall` (0–10) across meetings
//              in the window that have a review, mapped 0–5 pts
//              (halved to keep cadence + quality on equal footing)
// Rolling by construction: an 8-week meeting drought will drag both
// cadence and quality down as recent scores age out.

type MeetingAnalysisRow = {
  meeting_id: string;
  facilitation_review_json: FacilitationReview | null;
  meetings: { created_at: string; company_id: string | null } | null;
};

export async function scoreMeetings(
  admin: SupabaseClient,
  companyId: string
): Promise<DisciplineScore> {
  const cutoffMs = Date.now() - 8 * 7 * 24 * 60 * 60 * 1000;
  const cutoffIso = new Date(cutoffMs).toISOString();

  // Grab meetings for the company in the last 8 weeks + their
  // analysis row (if any). One query via the FK join.
  const { data: rows } = await admin
    .from("meeting_analyses")
    .select(
      "meeting_id, facilitation_review_json, meetings!inner(created_at, company_id)"
    )
    .eq("meetings.company_id", companyId)
    .gte("meetings.created_at", cutoffIso);

  const analyses = (rows ?? []) as unknown as MeetingAnalysisRow[];

  // Some Supabase JS versions return the join as an array-of-one.
  // Normalize either way so downstream code doesn't care.
  const flat = analyses.map((r) => {
    const meeting = Array.isArray(r.meetings) ? r.meetings[0] : r.meetings;
    return {
      created_at: meeting?.created_at ?? null,
      review: r.facilitation_review_json,
    };
  });

  const meetingCount = flat.length;

  // Cadence: which ISO weeks did meetings happen in?
  const weeksHit = new Set<string>();
  for (const row of flat) {
    if (!row.created_at) continue;
    weeksHit.add(isoWeekKey(new Date(row.created_at)));
  }
  const cadencePoints = (Math.min(8, weeksHit.size) / 8) * 5;

  // Quality: average `overall` across meetings that produced a review
  // with a non-null score.
  const qualityScores = flat
    .map((r) => r.review?.overall)
    .filter((s): s is number => typeof s === "number" && s >= 0);
  const meanQuality =
    qualityScores.length > 0
      ? qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length
      : 0;
  // Map a 0–10 quality score onto the 0–5 pt budget for this half.
  const qualityPoints = (meanQuality / 10) * 5;

  return {
    key: "meetings",
    score: clampScore(cadencePoints + qualityPoints),
    breakdown: {
      windowWeeks: 8,
      meetingCount,
      weeksWithMeeting: weeksHit.size,
      reviewsCounted: qualityScores.length,
      meanQuality: Math.round(meanQuality * 10) / 10,
    },
  };
}

// ISO week key ("2026-W33") — good enough for "distinct weeks with a
// meeting" without pulling a date library.
function isoWeekKey(d: Date): string {
  // Copy so we don't mutate the input.
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // Thursday of this ISO week is the anchor.
  const dayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const weekNumber =
    1 +
    Math.round(
      ((target.getTime() - firstThursday.getTime()) / 86400000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7
    );
  return `${target.getUTCFullYear()}-W${String(weekNumber).padStart(2, "0")}`;
}
