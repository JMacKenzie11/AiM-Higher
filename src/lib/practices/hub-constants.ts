import type { Role } from "@/lib/types";

// Shared between the Hub's client editors and its server actions, so
// the checklist a system admin ticks and the list the action accepts
// cannot drift apart.

// Label only. These carried a line of explanation each until
// 2026-09-22; a system admin is the only person who sees this
// screen and already knows what the platform roles mean, so the
// hints were five lines of noise above the control that matters.
export const HUB_ROLE_OPTIONS: ReadonlyArray<{
  value: Role;
  label: string;
}> = [
  { value: "team_member", label: "Team member" },
  { value: "company_admin", label: "Company admin" },
  { value: "aims_guide", label: "Guide" },
  { value: "portfolio_admin", label: "Portfolio admin" },
  { value: "system_admin", label: "System admin" },
];

export const HUB_ROLE_VALUES = new Set<string>(
  HUB_ROLE_OPTIONS.map((r) => r.value)
);

// The only access predicate this phase recognises. It keeps its
// existing implementation (a read of `functions` for a row this
// person leads) rather than becoming data: the relationship is a
// query, and a column that claimed otherwise would be describing a
// capability the runtime does not have.
export const FUNCTION_LEAD_PREDICATE = "function_lead";
