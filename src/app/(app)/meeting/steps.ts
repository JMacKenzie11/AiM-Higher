// The weekly meeting's steps, in the order Jeff runs it (all-hands,
// 2026-10-19): a positive check-in, each functional area's headlines,
// the numbers, the quarter's strategy, everyone's commitments, then
// solving the issues together, and a close. The facilitation review
// scores a transcript against its own five sections
// (AIMS_WEEKLY_SECTIONS in lib/leadership/facilitation/score.ts);
// this is the agenda, not the scorecard. `lead` is the line under the
// page title while that step is open.
export const MEETING_STEPS = [
  { key: "checkin", label: "Check-in", lead: "Start with what went well." },
  { key: "headlines", label: "Headlines", lead: "What happened in your area last week, and what's coming." },
  { key: "numbers", label: "Numbers", lead: "The numbers worth talking about this week." },
  { key: "strategy", label: "Strategy", lead: "The quarter's priorities that still need moving." },
  { key: "commitments", label: "Commitments", lead: "Each person's week: kept, moved, or new." },
  { key: "solve", label: "Solve", lead: "What do you need support on? What haven't you been able to solve on your own yet?" },
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

// THE CHECK-IN QUESTION. A positive check-in is about the people, not
// the work (Jason, 2026-10-19), so it is a plain, open question, one
// of a few that turn over week by week so the room is not answering
// the same one every Monday. Picked by the week the meeting falls in,
// so a reload or a step back shows the same one.
export const CHECK_IN_QUESTIONS = [
  "What's one good thing from your week, at work or outside it?",
  "What went well for you this week?",
  "Who made your week better, and how?",
  "What are you looking forward to this week?",
] as const;

export function checkInQuestion(todayIso: string): string {
  const day = Math.floor(Date.parse(`${todayIso}T00:00:00Z`) / 86_400_000);
  // Days since 1970-01-01, a Thursday; +3 moves the week to start on
  // Monday, so the whole of one Monday-to-Sunday week shares a question.
  const week = Math.floor((day + 3) / 7);
  return CHECK_IN_QUESTIONS[((week % CHECK_IN_QUESTIONS.length) + CHECK_IN_QUESTIONS.length) % CHECK_IN_QUESTIONS.length];
}
