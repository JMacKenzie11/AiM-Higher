import { isAdminForCompany } from "@/lib/auth/permissions";
import type { Profile } from "@/lib/types";
import type { Practice } from "./registry";
import type { ResolvedAgent } from "./resolve";

// Central role/scope check for launching a practice. Called from the
// server-action layer AND the direct-launch route (/ask-aimee/new)
// so the same message shows whether the user hits a card or the URL.
//
// EVERY CALLER PASSES A MERGED AGENT, not a raw registry entry, or
// the Hub's access edits would apply on one surface and not the
// next. The parameter stays typed as Practice because a merged
// agent IS one, with the identity and access fields overlaid.
//
// Guides are gate-eligible when a practice's allowedRoles includes
// "aims_guide", but they additionally need an assignment to the
// scoped company — a guide with no caseload for this tenant is
// denied even though the role passes.

export type PracticeGateResult =
  | { ok: true }
  | { ok: false; message: string };

export type GateProfile = Pick<Profile, "id" | "role" | "company_id"> & {
  guide_company_ids: readonly string[];
};

// The feature half of the gate, separate because it needs a round
// trip and the role half does not. Callers that already know the
// company's features pass the answer in; the rest await
// practiceGate below.
export function practiceFeatureGate(
  practice: Practice,
  hasFeature: boolean
): PracticeGateResult {
  if (!practice.feature) return { ok: true };
  if (!hasFeature) {
    return {
      ok: false,
      message: "That agent isn't switched on for this company.",
    };
  }
  return { ok: true };
}

export function practiceRoleGate(
  practice: Practice,
  profile: GateProfile,
  companyId: string
): PracticeGateResult {
  if (!practice.allowedRoles) return { ok: true };
  if (!practice.allowedRoles.includes(profile.role)) {
    return {
      ok: false,
      message: "That practice isn't available for your role.",
    };
  }
  if (profile.role === "aims_guide") {
    if (!isAdminForCompany(profile, companyId)) {
      return {
        ok: false,
        message: "You aren't assigned to this company.",
      };
    }
  }
  return { ok: true };
}

// The company allowlist. Empty admits everybody, which is what an
// agent with no allowlist means and what all five seed with — so
// "unset" and "every company" stay the same thing rather than
// becoming a distinction somebody has to remember.
//
// Checked IN ADDITION to role and feature, never instead of them: a
// company being on the list does not make a team_member an admin.
export function practiceCompanyGate(
  agent: Pick<ResolvedAgent, "companyAllowlist">,
  companyId: string
): PracticeGateResult {
  const list = agent.companyAllowlist ?? [];
  if (list.length === 0) return { ok: true };
  if (list.includes(companyId)) return { ok: true };
  return {
    ok: false,
    message: "That agent isn't switched on for this company.",
  };
}

// Both halves, for a caller that can await. Role first, so a member
// who is refused by role is told that rather than being told the
// company's packaging.
export async function practiceGate(
  practice: Practice & Partial<Pick<ResolvedAgent, "companyAllowlist">>,
  profile: GateProfile,
  companyId: string
): Promise<PracticeGateResult> {
  // The allowlist first among the company checks, because it is the
  // cheapest and the most absolute: a company that is not on it
  // cannot reach the agent by any role.
  const allowlist = practiceCompanyGate(
    { companyAllowlist: practice.companyAllowlist ?? [] },
    companyId
  );
  if (!allowlist.ok) return allowlist;

  const role = practiceRoleGate(practice, profile, companyId);
  // A refusal by ROLE is not final when the practice admits function
  // leads: a seat's Lead is usually a team_member, and no list of
  // platform roles can say "the person who runs a function". The
  // relationship is asked only when the role list has already said
  // no, so the extra read costs nothing for an admin.
  if (!role.ok) {
    if (!practice.alsoFunctionLeads) return role;
    const { leadsAnyFunction } = await import("./function-leads");
    if (!(await leadsAnyFunction(profile.id, companyId))) return role;
  }
  if (!practice.feature) return { ok: true };
  const { companyHasFeature } = await import("@/lib/subscriptions/service");
  return practiceFeatureGate(
    practice,
    await companyHasFeature(companyId, practice.feature)
  );
}
