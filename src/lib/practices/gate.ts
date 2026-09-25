import { isAdminForCompany } from "@/lib/auth/permissions";
import type { Profile } from "@/lib/types";
import type { Practice } from "./registry";

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

// Both halves, for a caller that can await. Role first, so a member
// who is refused by role is told that rather than being told the
// company's packaging.
export async function practiceGate(
  practice: Practice,
  profile: GateProfile,
  companyId: string
): Promise<PracticeGateResult> {
  const role = practiceRoleGate(practice, profile, companyId);
  // A refusal by ROLE is not final when the practice names an access
  // PREDICATE. A seat's Lead is usually a team_member, and the AiMS
  // champion often is too; no list of platform roles can say "the
  // person who runs a function" or "the person who runs the rhythm
  // here". A relationship can. Predicates are asked only once the
  // role list has already said no, so the extra read costs nothing
  // for an admin, who was admitted on the first line.
  if (!role.ok) {
    if (!(await admittedByPredicate(practice, profile, companyId))) {
      return role;
    }
  }
  if (!practice.feature) return { ok: true };
  const { companyHasFeature } = await import("@/lib/subscriptions/service");
  return practiceFeatureGate(
    practice,
    await companyHasFeature(companyId, practice.feature)
  );
}

// Does a relationship admit somebody the role list refused?
//
// Each predicate is one round trip and they are asked in order, so
// the common case — an agent naming one predicate — is one read.
// Imported lazily, per predicate, to keep this module loadable from
// the client-side picker, which calls practiceRoleGate alone.
async function admittedByPredicate(
  practice: Practice,
  profile: GateProfile,
  companyId: string
): Promise<boolean> {
  if (practice.alsoFunctionLeads) {
    const { leadsAnyFunction } = await import("./function-leads");
    if (await leadsAnyFunction(profile.id, companyId)) return true;
  }
  if (practice.alsoAimsChampion) {
    const { isAimsChampion } = await import("@/lib/guide/champion");
    if (await isAimsChampion(profile.id, companyId)) return true;
  }
  return false;
}
