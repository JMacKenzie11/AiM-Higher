import type { Role } from "@/lib/types";

// Shared between the Hub's client editors and its server actions, so
// the checklist a system admin ticks and the list the action accepts
// cannot drift apart.

export const HUB_ROLE_OPTIONS: ReadonlyArray<{
  value: Role;
  label: string;
  hint: string;
}> = [
  {
    value: "team_member",
    label: "Team member",
    hint: "Everybody in the company who is not an admin.",
  },
  {
    value: "company_admin",
    label: "Company admin",
    hint: "Runs their own company.",
  },
  {
    value: "aims_guide",
    label: "Guide",
    hint: "Only on the companies they are assigned to.",
  },
  {
    value: "portfolio_admin",
    label: "Portfolio admin",
    hint: "Reads across the portfolio. Rarely wants an agent.",
  },
  {
    value: "system_admin",
    label: "System admin",
    hint: "AiMS staff.",
  },
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
