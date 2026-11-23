import type { MeetingKind } from "@/lib/types";

// WHAT AN ANALYSIS RUN MAY WRITE, BY KIND (0326).
//
// A team meeting's analysis reaches into the rest of the company: it
// creates commitments when automatic tracking is on, fills the week's
// Headlines boxes, and counts in analytics. A coaching call does none of it. Its summary,
// coaching notes and extracted lists are stored on the analysis row
// like any meeting's, and read only on the call's own page by its
// coaches, its admins and the people they have added (0329).
//
// One switch per effect, so a later decision (Jason may want "Add to
// commitments" on a call one day) changes one line here rather than a
// condition buried in the pipeline.
export type AnalysisRunPlan = {
  createCommitments: boolean;
  fillHeadlines: boolean;
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
// only; the roles in brackets are the app's words for them. The people
// a coach or admin added carry no bracket: being on the list is the
// whole reason.
//   "Only Jason MacKenzie (coach), Taylor Jones and Anna Lane (admins),
//    and Sam Patel can see these calls."
export function coachingReadersLine(
  readers: {
    coaches: readonly string[];
    admins: readonly string[];
    viewers: ReadonlyArray<{ name: string }>;
  },
  what: "this call" | "these calls"
): string {
  const clean = (names: readonly string[]) => names.map((n) => n.trim()).filter((n) => n !== "");
  const coaches = clean(readers.coaches);
  const admins = clean(readers.admins).filter((n) => !coaches.includes(n));
  const others = clean(readers.viewers.map((v) => v.name)).filter((n) => !coaches.includes(n) && !admins.includes(n));
  const groups: string[] = [];
  if (coaches.length > 0) groups.push(`${listNames(coaches)} (${coaches.length === 1 ? "coach" : "coaches"})`);
  if (admins.length > 0) groups.push(`${listNames(admins)} (${admins.length === 1 ? "admin" : "admins"})`);
  if (others.length > 0) groups.push(listNames(others));
  if (groups.length === 0) return `Only the company's coach and its admins can see ${what}.`;
  if (groups.length === 1) return `Only ${groups[0]} can see ${what}.`;
  // Two groups read "A (coach) and B (admin)", unless the first is
  // itself a list ("A and B (coaches), and C"), where a plain "and"
  // would blur where one group ends. Three read with commas.
  const firstIsList = groups.length === 2 && [coaches, admins, others].find((g) => g.length > 0)!.length > 1;
  const joined =
    groups.length === 2 && !firstIsList
      ? `${groups[0]} and ${groups[1]}`
      : `${groups.slice(0, -1).join(", ")}, and ${groups[groups.length - 1]}`;
  return `Only ${joined} can see ${what}.`;
}

function listNames(names: readonly string[]): string {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// THE ADD BUTTONS ON A COACHING CALL'S PAGE: Add, Convert to issue,
// Resolved in meeting, Add to open issues. On (Jason, 2026-11-18; off
// from 2026-11-16): a call's page lists what it drew out with the same
// buttons as a team meeting with automatic tracking off, for the
// company's admins and coaches. A call still never creates anything by
// itself (coachingRunPlan: no commitments, no issues); only a person
// pressing a button does, through routing-actions.ts.
export const COACHING_CALL_ITEMS_CAN_BE_ADDED: boolean = true;

// THE COACHING NOTES TAB ON A COACHING CALL'S PAGE. Hidden (Jason,
// 2026-11-16, "we'll decide if we want to keep it later"): the call is
// still analysed in full and its notes and review are still stored on
// the analysis row, only the page leaves the tab out. With it hidden
// and the add buttons off, a call has one tab, so the page shows the
// analysis with no tab row. Set this to bring the tab back.
export const COACHING_CALL_NOTES_SHOWN: boolean = false;
