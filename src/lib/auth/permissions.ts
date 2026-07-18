import "server-only";

import type { Profile, Role } from "@/lib/types";

// Shared permission primitives. Every server action + page loader used
// to redefine these locally with tiny drift between copies; the risk
// there is a policy divergence that silently opens or closes access.
// Keep one source of truth and let the callers stay short.

export type SessionProfileLike = Pick<Profile, "id" | "role" | "company_id">;

/**
 * true if the session role is system_admin, OR if the session is a
 * company_admin scoped to the given company. Owner-level checks are
 * NOT included — combine with `isOwner` when you need "admin or owner".
 */
export function isAdminForCompany(
  profile: Pick<Profile, "role" | "company_id">,
  companyId: string
): boolean {
  const role: Role = profile.role;
  if (role === "system_admin") return true;
  return role === "company_admin" && profile.company_id === companyId;
}

/**
 * Standard "admin OR owner" check used by every commitment write path.
 * The row must expose `company_id` and `owner_id`. Kept sync so callers
 * that already loaded the row don't need to wrap in an async block.
 */
export function canWriteOwnedRow(
  profile: SessionProfileLike,
  row: { company_id: string; owner_id: string }
): boolean {
  if (isAdminForCompany(profile, row.company_id)) return true;
  return row.owner_id === profile.id;
}

/**
 * Resolve the company_id to write against. system_admins may submit any
 * company (via a form field); everyone else is pinned to their own.
 * Returns null when we can't determine one — caller should surface a
 * message rather than silently insert against the wrong company.
 */
export function scopedCompanyId(
  session: { profile: Pick<Profile, "role" | "company_id"> },
  formCompanyId: string
): string | null {
  if (session.profile.role === "system_admin") {
    return formCompanyId || session.profile.company_id;
  }
  return session.profile.company_id;
}
