import { isAdminForCompany } from "@/lib/auth/permissions";
import type { Profile } from "@/lib/types";
import type { Practice } from "./registry";

// Central role/scope check for launching a practice. Called from the
// server-action layer AND the direct-launch route (/ask-aimee/new)
// so the same message shows whether the user hits a card or the URL.
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
