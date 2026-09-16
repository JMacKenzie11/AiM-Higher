import "server-only";

import { assertCompanyAccess, getEffectiveCompanyId } from "@/lib/admin/scope";
import type { Profile, Role } from "@/lib/types";

// Shared permission primitives. Every server action + page loader used
// to redefine these locally with tiny drift between copies; the risk
// there is a policy divergence that silently opens or closes access.
// Keep one source of truth and let the callers stay short.

// SessionProfileLike is the minimum a permission helper needs. Guide
// and portfolio callers must also expose their assignment lists so
// isAdminForCompany can stay synchronous — the assignments are loaded
// once at session resolution and travel with the profile from there.
export type SessionProfileLike = Pick<Profile, "id" | "role" | "company_id"> & {
  guide_company_ids?: readonly string[];
  portfolio_company_ids?: readonly string[];
};

/**
 * true if the session role is system_admin, OR the session is a
 * company_admin scoped to the given company, OR the session is an
 * aims_guide whose assignments include the given company, OR the
 * session is a portfolio_admin whose assignments include it. Owner-
 * level checks are NOT included — combine with an owner check when
 * you need "admin or owner".
 *
 * THE PORTFOLIO BRANCH IS PER-COMPANY, and that is the whole point of
 * it. Instance-wide reach is a different question, answered by
 * canViewCompany below, and the two must not be collapsed. A
 * portfolio admin with no assignment row returns false here and every
 * edit affordance in the app stays off, which is what this role has
 * always done; one with an assignment gets company-admin-equivalent
 * writes in that company and nowhere else.
 *
 * RLS SAYS THE SAME THING AND SAID IT FIRST. `is_admin_for()`
 * (migration 0199) already grants exactly this through
 * portfolio_assignments, and the ~117 policies that call it inherited
 * it with no edit. Until this branch existed the app layer was the
 * STRICTER of the two: RLS would have allowed the write and the app
 * never offered it. That is the safe direction to be wrong in, and it
 * is why this change adds no grant — it stops the courtesy layer from
 * refusing what the boundary already permits.
 */
export function isAdminForCompany(
  profile: SessionProfileLike,
  companyId: string
): boolean {
  const role: Role = profile.role;
  if (role === "system_admin") return true;
  if (role === "company_admin") return profile.company_id === companyId;
  if (role === "aims_guide") {
    return (profile.guide_company_ids ?? []).includes(companyId);
  }
  if (role === "portfolio_admin") {
    return (profile.portfolio_company_ids ?? []).includes(companyId);
  }
  return false;
}

/**
 * true if the session role is portfolio_admin, whatever they are
 * assigned to.
 *
 * Deliberately NOT folded into isAdminForCompany, and the reason
 * survived the arrival of assignments intact. That helper answers
 * "may this caller WRITE here", which for this role is now a
 * per-company question with an answer that is usually no: instance-
 * wide reach plus a closed list of administrative writes on the
 * container is what the ROLE carries, and content writes come only
 * from an assignment row. Folding the two together would light up
 * every edit button on every content surface for companies the
 * caller holds no assignment for — an affordance that lies, and one
 * RLS would then refuse.
 */
export function isPortfolioAdmin(profile: Pick<Profile, "role">): boolean {
  return profile.role === "portfolio_admin";
}

/**
 * true if the caller may VIEW the given company.
 *
 * The read counterpart of isAdminForCompany. Everyone that helper
 * admits, plus portfolio_admin for any company on the instance —
 * their scope is the instance, so there is no per-company condition
 * to check here. There IS an assignment table now (0199), and this
 * function still does not consult it: reads were never what it
 * gated, and an assignment is about writing.
 *
 * Use this for page-level access gates. Use isAdminForCompany for
 * anything that decides whether a write is offered.
 */
export function canViewCompany(
  profile: SessionProfileLike,
  companyId: string
): boolean {
  if (profile.role === "portfolio_admin") return true;
  return isAdminForCompany(profile, companyId);
}

/**
 * Standard "admin OR owner" check used by every commitment write path.
 * The row must expose `company_id` and `owner_id` (which may be null
 * for unassigned commitments extracted from meeting transcripts).
 * Null owners are treated as writable by admins only; team members
 * claim an unassigned commitment through a dedicated action, which
 * mirrors the commitments_claim_unassigned RLS policy.
 */
export function canWriteOwnedRow(
  profile: SessionProfileLike,
  row: { company_id: string; owner_id: string | null }
): boolean {
  if (isAdminForCompany(profile, row.company_id)) return true;
  if (row.owner_id === null) return false;
  return row.owner_id === profile.id;
}

/**
 * Guard for transcript-source management (Google Drive folders and
 * future providers). System admins have unconditional access.
 * Company admins and aims_guides are admitted so they can set up
 * transcripts for their own company / the companies they coach;
 * whether a specific company is theirs is checked separately (via
 * isAdminForCompany) at the action layer. Every caller reads through
 * this so the policy stays in one spot.
 */
export function transcriptSourcesAllowed(
  profile: Pick<Profile, "role">
): boolean {
  return (
    profile.role === "system_admin" ||
    profile.role === "aims_guide" ||
    profile.role === "company_admin"
  );
}

/**
 * Resolve the company_id to write against. Precedence:
 *   1. system_admin or aims_guide with an explicit form value → use it
 *      (cross-company writes on behalf of a specific company)
 *   2. system_admin or aims_guide with a scope cookie → use it
 *   3. everyone else → their profile.company_id
 * Returns null when we can't determine one — caller should surface a
 * message rather than silently insert against the wrong company.
 *
 * Async because the sysadmin / guide fallback reads the HTTP-only
 * scope cookie.
 */
export async function scopedCompanyId(
  session: { profile: SessionProfileLike },
  formCompanyId: string
): Promise<string | null> {
  const role = session.profile.role;
  let resolved: string | null;
  if (
    role === "system_admin" ||
    role === "aims_guide" ||
    role === "portfolio_admin"
  ) {
    if (formCompanyId) {
      resolved = formCompanyId;
    } else {
      // None of the three cross-company roles has a primary
      // company_id; fall through to the scope cookie via the shared
      // resolver.
      resolved = await getEffectiveCompanyId(session);
    }
  } else {
    resolved = session.profile.company_id;
  }
  // Belt-and-suspenders backstop. For sysadmins this is a no-op; for
  // guides it enforces the target is in their assignments; for
  // company users it enforces the resolved value equals their own
  // company_id. Throws CrossTenantAccessError on violation so a
  // regression fails loud instead of quietly returning wrong-tenant
  // scope.
  if (resolved !== null) {
    assertCompanyAccess(
      {
        profile: {
          ...session.profile,
          guide_company_ids: session.profile.guide_company_ids ?? [],
        },
      },
      resolved
    );
  }
  return resolved;
}
