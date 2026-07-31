import "server-only";

import { getEffectiveCompanyId } from "@/lib/admin/scope";
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
 * future providers). Currently system_admin only. Widening to
 * company_admin is a one-line change here — every caller (server
 * actions, page loaders, and RLS mirrors) reads through this so the
 * policy has one source of truth.
 */
export function transcriptSourcesAllowed(
  profile: Pick<Profile, "role">
): boolean {
  return profile.role === "system_admin";
}

/**
 * Resolve the company_id to write against. Precedence:
 *   1. system_admin with an explicit form value → use it (cross-company writes)
 *   2. system_admin with a scope cookie → use the scoped company
 *   3. everyone else → their profile.company_id
 * Returns null when we can't determine one — caller should surface a
 * message rather than silently insert against the wrong company.
 *
 * Async because the sysadmin fallback reads the HTTP-only scope cookie.
 */
export async function scopedCompanyId(
  session: { profile: Pick<Profile, "id" | "role" | "company_id"> },
  formCompanyId: string
): Promise<string | null> {
  if (session.profile.role === "system_admin") {
    if (formCompanyId) return formCompanyId;
    // Session profile has no company_id for sysadmins; fall through to
    // the scope cookie via the shared resolver.
    return getEffectiveCompanyId(session);
  }
  return session.profile.company_id;
}
