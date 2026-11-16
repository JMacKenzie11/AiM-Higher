import type { MeetingKind } from "@/lib/types";

// WHAT AN ANALYSIS RUN MAY WRITE, BY KIND (0326).
//
// A team meeting's analysis reaches into the rest of the company: it
// creates commitments when automatic tracking is on, fills the week's
// Headlines boxes, invites the champion to a debrief with Aimee, and
// counts in analytics. A coaching call does none of it. Its summary,
// coaching notes and extracted lists are stored on the analysis row
// like any meeting's, and read only on the call's own page by its
// coach and its AiMS Champion.
//
// One switch per effect, so a later decision (Jason may want "Add to
// commitments" on a call one day) changes one line here rather than a
// condition buried in the pipeline.
export type AnalysisRunPlan = {
  createCommitments: boolean;
  fillHeadlines: boolean;
  raiseNudge: boolean;
  trackEvent: boolean;
  // The facilitation score: the five parts, the overall and the
  // Facilitation signal. Built for the weekly leadership meeting, so a
  // coaching call has none (Jason, 2026-11-16): its review keeps the
  // notes and questions, and every number is left empty.
  scoreReview: boolean;
};

export function coachingRunPlan(kind: MeetingKind | null | undefined): AnalysisRunPlan {
  const team = isTeamMeeting(kind);
  return {
    createCommitments: team,
    fillHeadlines: team,
    raiseNudge: team,
    trackEvent: team,
    scoreReview: team,
  };
}

// A facilitation review with every number taken out: the overall, each
// dimension's score and the agenda count. The notes, strengths, growth
// edges, 4Ws and questions stay. Stored this way for a coaching call,
// so nothing that reads scores (the strip, Coach HQ's weak-review
// trigger, the scorecard) can find one, even by mistake.
export function withoutScores<
  T extends {
    overall: number | null;
    dimensions: Record<string, { score: number | null; notes: string } | undefined>;
    agenda_adherence: { score_out_of_5: number | null; notes: string };
  },
>(review: T): T {
  const dimensions = Object.fromEntries(
    Object.entries(review.dimensions).map(([k, d]) => [k, d ? { ...d, score: null } : d])
  ) as T["dimensions"];
  return {
    ...review,
    overall: null,
    dimensions,
    agenda_adherence: { ...review.agenda_adherence, score_out_of_5: null },
  };
}

// A row with no kind is a team meeting: the column's default, and what
// every row was before 0326.
export function isTeamMeeting(kind: MeetingKind | null | undefined): boolean {
  return (kind ?? "team") === "team";
}

// Who can see a coaching call, said on its page and its tab. Names
// only; the roles in brackets are the app's words for them.
export function coachingReadersLine(
  readers: { coaches: readonly string[]; champion: string | null },
  what: "this call" | "these calls"
): string {
  const coaches = readers.coaches.filter((n) => n.trim() !== "");
  const parts: string[] = [];
  if (coaches.length > 0) {
    parts.push(`${listNames(coaches)} (${coaches.length === 1 ? "coach" : "coaches"})`);
  }
  if (readers.champion?.trim()) {
    parts.push(`${readers.champion.trim()} (AiMS Champion)`);
  }
  if (parts.length === 0) return `Only the company's coach and its AiMS Champion can see ${what}.`;
  return `Only ${parts.join(coaches.length > 1 ? ", and " : " and ")} can see ${what}.`;
}

function listNames(names: readonly string[]): string {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// THE ADD BUTTONS ON A COACHING CALL'S PAGE: Add, Convert to issue,
// Resolved in meeting, Add to open issues. Off (Jason, 2026-11-16):
// what a call extracts is listed read-only. To turn them on, set this
// and take the kind = 'team' filter off the four meeting reads in
// routing-actions.ts, which refuse a call today.
export const COACHING_CALL_ITEMS_CAN_BE_ADDED: boolean = false;

// THE COACHING NOTES TAB ON A COACHING CALL'S PAGE. Hidden (Jason,
// 2026-11-16, "we'll decide if we want to keep it later"): the call is
// still analysed in full and its notes and review are still stored on
// the analysis row, only the page leaves the tab out. With it hidden
// and the add buttons off, a call has one tab, so the page shows the
// analysis with no tab row. Set this to bring the tab back.
export const COACHING_CALL_NOTES_SHOWN: boolean = false;
