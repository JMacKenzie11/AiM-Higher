// HOW MUCH AN OUTSIDE ASSISTANT MAY DO, per person and per company.
//
// Jason, 2026-10-13 (the safety list): limits on how much one person or
// company can do in a short time. Counted from assistant_actions (0273),
// the action log, so there is no second store to keep in step: every
// call is logged, including the ones refused here, so an assistant that
// keeps hammering stays refused until it slows down.
//
// The numbers are generous for a person reading their own week through
// a chat (a busy conversation is a handful of calls a minute) and tight
// for a script. A company's limit is several people's worth.

export const LIMITS = {
  person: { perMinute: 30, perHour: 300 },
  company: { perMinute: 120, perHour: 1200 },
} as const;

export type RecentCounts = { lastMinute: number; lastHour: number };

// Which limit, if any, this call would break. Null means go ahead.
export function limitBroken(
  person: RecentCounts,
  company: RecentCounts | null
): "person_minute" | "person_hour" | "company_minute" | "company_hour" | null {
  if (person.lastMinute >= LIMITS.person.perMinute) return "person_minute";
  if (person.lastHour >= LIMITS.person.perHour) return "person_hour";
  if (company && company.lastMinute >= LIMITS.company.perMinute) return "company_minute";
  if (company && company.lastHour >= LIMITS.company.perHour) return "company_hour";
  return null;
}

export function limitMessage(broken: NonNullable<ReturnType<typeof limitBroken>>): string {
  switch (broken) {
    case "person_minute":
      return `That's more than ${LIMITS.person.perMinute} AiMS requests from you in the last minute. Wait a minute and try again.`;
    case "person_hour":
      return `That's more than ${LIMITS.person.perHour} AiMS requests from you in the last hour. Try again later.`;
    case "company_minute":
      return `That company has had more than ${LIMITS.company.perMinute} AI app requests in the last minute. Wait a minute and try again.`;
    case "company_hour":
      return `That company has had more than ${LIMITS.company.perHour} AI app requests in the last hour. Try again later.`;
  }
}
