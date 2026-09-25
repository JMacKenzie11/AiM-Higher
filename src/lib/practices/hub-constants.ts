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

// The AiMS champion: the one person per company Aimee sends the
// week's nudge to. A predicate and not a role because the seat
// routes attention rather than granting access — an agent naming it
// admits the champion ON TOP OF its role list, and the company
// admins it already admits keep their access whether or not they
// hold the seat.
//
// Same reason as function_lead for staying a query rather than
// becoming data: the answer is a column on `companies` and a copy
// here would be a second truth to keep in step.
export const AIMS_CHAMPION_PREDICATE = "aims_champion";

// Every predicate the Hub's access editor MODELS. Anything stored
// on an agent outside this set is preserved untouched on save.
//
// Without that, the editor is a silent revoker: the drawer renders
// one checkbox, so saving access on an agent carrying a predicate
// the checkbox does not know about would write it away, and the
// admin would see a confirmation sentence that never mentioned what
// they had just removed.
export const MODELLED_ACCESS_PREDICATES: readonly string[] = [
  FUNCTION_LEAD_PREDICATE,
];

// What a save writes: the checkbox's answer, plus anything the
// editor does not model, in a stable order.
export function mergeAccessPredicates(
  existing: readonly string[] | null | undefined,
  functionLead: boolean
): string[] {
  const kept = (existing ?? []).filter(
    (p) => !MODELLED_ACCESS_PREDICATES.includes(p)
  );
  return functionLead ? [FUNCTION_LEAD_PREDICATE, ...kept] : [...kept];
}
