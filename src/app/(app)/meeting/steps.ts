// The weekly meeting's steps, in the order the facilitation review
// scores a meeting against (AIMS_WEEKLY_SECTIONS in
// lib/leadership/facilitation/score.ts), then a close. `lead` is the
// line under the page title while that step is open.
export const MEETING_STEPS = [
  { key: "checkin", label: "Check-in", lead: "Start with what went well." },
  { key: "numbers", label: "Numbers", lead: "The numbers worth talking about this week." },
  { key: "strategy", label: "Strategy", lead: "The quarter's priorities that still need moving." },
  { key: "solve", label: "Solve", lead: "Work the issues in order, and agree the next step on each." },
  { key: "commitments", label: "Commitments", lead: "Each person's week: kept, moved, or new." },
  { key: "close", label: "Close", lead: "What changed in this meeting." },
] as const;

export type MeetingStep = (typeof MEETING_STEPS)[number]["key"];

export function stepAfter(step: MeetingStep): MeetingStep | null {
  const i = MEETING_STEPS.findIndex((s) => s.key === step);
  return MEETING_STEPS[i + 1]?.key ?? null;
}

export function stepBefore(step: MeetingStep): MeetingStep | null {
  const i = MEETING_STEPS.findIndex((s) => s.key === step);
  return i > 0 ? MEETING_STEPS[i - 1].key : null;
}
