import { COMPANY_FEATURES } from "@/lib/companies/features";
import { HUB_ROLE_OPTIONS, FUNCTION_LEAD_PREDICATE } from "./hub-constants";

// Who a publish is about to expose an agent to, in a sentence.
//
// Rendered on EVERY publish confirm, not only a first one. An admin
// should never send an agent to the fleet without having read a line
// that says so, and the access settings live on a different tab, so
// "you chose that already" is not a defence.
//
// ---- ONE DISAGREEMENT WITH THE SPEC, STATED ------------------
//
// The phase instruction gives "Visible to: nobody (no roles
// selected)" as an example. That is not what no roles selected means
// in this product. Phase 1 defined an empty `allowed_roles` as EVERY
// role — it is what all five agents seed with, what the checklist
// says out loud ("Check nothing to let every role use it"), and what
// practiceRoleGate implements. Rendering it as "nobody" would be the
// sentence lying in the most dangerous direction: an admin reading
// "nobody" while publishing to the entire fleet.
//
// There is no "visible to nobody" state to warn about. The closest
// thing is a feature nobody has switched on, and the sentence names
// the feature so that is visible on its face.

export type AudienceAccess = {
  allowedRoles: string[];
  accessPredicates: string[];
  feature: string | null;
};

export function audienceSentence(access: AudienceAccess): string {
  const where = access.feature
    ? `companies with ${featureLabel(access.feature)} switched on`
    : "all companies";

  // Empty means every role. See the note above.
  if (access.allowedRoles.length === 0) {
    return `This agent will be visible to everyone in ${where}.`;
  }

  const parts = access.allowedRoles.map(pluralRoleLabel);
  if (access.accessPredicates.includes(FUNCTION_LEAD_PREDICATE)) {
    parts.push("anyone who leads a function");
  }

  return `This agent will be visible to ${joinWords(parts)} in ${where}.`;
}

function featureLabel(value: string): string {
  return COMPANY_FEATURES.find((f) => f.value === value)?.label ?? value;
}

// "company admins", "guides", "system admins". Each pluralised, not
// just the last one in the list.
function pluralRoleLabel(role: string): string {
  const label =
    HUB_ROLE_OPTIONS.find((o) => o.value === role)?.label.toLowerCase() ?? role;
  return label.endsWith("s") ? label : `${label}s`;
}

function joinWords(parts: string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

// The slug an agent gets, derived from its title.
//
// Generated ONCE at creation and immutable afterwards, because
// coaching_conversations.practice_id stores it as text and every
// conversation ever run on the agent hangs off it. Renaming the
// agent changes its title; this never moves.
export function slugFromTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
