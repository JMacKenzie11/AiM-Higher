import type { Role } from "@/lib/types";
import { pathMatchesPattern } from "@/lib/pages/registry";

// THE QUESTIONS AIMEE OFFERS WHEN HER PANEL OPENS, by page and role.
//
// Two or three per page, written the way a leader would ask, and only
// ones she can answer from what she can see today: the help, the
// company's purpose and values, company-wide history, the person's own
// memory, and the name and description of the record on screen. A
// question that would get "I can't see that" is worse than none.
//
// Clicking one asks it. They show while the conversation is empty.
//
// EMPTY UNTIL JASON APPROVES THE LIST (2026-09-29). The draft is on
// the review page; the entries go in here unchanged once it is signed
// off. Until then the panel shows the greeting alone.

// Company admins, guides and system admins working inside a company.
export const LEADERS: readonly Role[] = ["company_admin", "aims_guide", "system_admin"];

export type SuggestionEntry = {
  // The page, and any others that share its questions (a lesson's
  // sections, every Aimee conversation page).
  patterns: readonly string[];
  rows: ReadonlyArray<{ roles: "all" | readonly Role[]; questions: readonly string[] }>;
};

export const SUGGESTIONS: readonly SuggestionEntry[] = [];

export function suggestionsFor(
  pathname: string,
  role: Role,
  entries: readonly SuggestionEntry[] = SUGGESTIONS
): string[] {
  const entry = entries.find((e) => pathMatchesPattern(pathname, e.patterns));
  if (!entry) return [];
  const row = entry.rows.find((r) => r.roles === "all" || r.roles.includes(role));
  return row ? [...row.questions].slice(0, 3) : [];
}

export function panelGreeting(firstName: string | null): string {
  return firstName
    ? `Hi ${firstName}. Ask me about anything on this page, or anything on your mind.`
    : "Hi. Ask me about anything on this page, or anything on your mind.";
}
