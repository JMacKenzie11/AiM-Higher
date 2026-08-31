import "server-only";

import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Profile, Role } from "@/lib/types";

// Cross-company scoping (Section 7 + 8.9).
//
// system_admin has no company; when they open a specific company
// from /admin/companies, we stash the company id in an HTTP-only
// cookie so every subsequent request resolves the app pages against
// it. aims_guide follows the same pattern for their assigned
// companies. Team members and company admins ignore the cookie
// entirely — their scope is always their own profile row.
//
// Server actions that mutate this cookie live in scope-actions.ts so
// they can be imported from Client Components.

export const SCOPE_COOKIE_NAME = "aims_scope_company";
export const SCOPE_COOKIE_MAX_AGE = 60 * 60 * 8; // 8 hours

export type Scopeable = {
  profile: Pick<Profile, "id" | "company_id" | "role"> & {
    guide_company_ids?: readonly string[];
  };
};

export async function getScopedCompanyId(): Promise<string | null> {
  const jar = await cookies();
  const value = jar.get(SCOPE_COOKIE_NAME)?.value;
  return value && value.length > 0 ? value : null;
}

// Thrown when a caller would be routed to a company they don't have
// access to. Fail-loud invariant enforcement — the audit found no
// path today that trips this, but we want an immediate 500 if a
// future bug ever tries to serve a company user another tenant's
// data. Grepable in logs / error monitoring.
export class CrossTenantAccessError extends Error {
  constructor(
    public readonly profileId: string,
    public readonly ownCompanyId: string | null,
    public readonly attemptedCompanyId: string,
    public readonly role: string
  ) {
    super(
      `CrossTenantAccessError: ${role} ${profileId} (own=${ownCompanyId ?? "null"}) attempted access to ${attemptedCompanyId}`
    );
    this.name = "CrossTenantAccessError";
  }
}

// Belt-and-suspenders backstop: hard-asserts that the caller is
// allowed to see targetCompanyId. Never returns a value — throws on
// violation. Meant to sit at every choke point where a companyId
// arrives from outside the caller's own profile (cookie, form
// input, propagated arg). Existing checks (scopedCompanyId,
// getEffectiveCompanyId, isAdminForCompany) already enforce the
// same rules; this exists so a future bug that bypasses those
// throws instead of silently serving wrong-tenant data.
//
// - system_admin: bypass unconditionally.
// - aims_guide: allowed iff the target is in their assignments.
// - company_admin / team_member: MUST match profile.company_id.
export function assertCompanyAccess(
  session: Scopeable,
  targetCompanyId: string
): void {
  const { role, company_id } = session.profile;
  if (role === "system_admin") return;
  if (role === "aims_guide") {
    const assignments = session.profile.guide_company_ids ?? [];
    if (assignments.includes(targetCompanyId)) return;
    throw new CrossTenantAccessError(
      session.profile.id,
      company_id,
      targetCompanyId,
      role
    );
  }
  // company_admin or team_member — must exactly match own company.
  if (company_id === targetCompanyId) return;
  throw new CrossTenantAccessError(
    session.profile.id,
    company_id,
    targetCompanyId,
    role
  );
}

// Resolves the "current company" for the caller in one place. Every
// company-scoped page (dashboard, plan, weekly-review, etc.) uses
// this to know which company_id to read.
//
// aims_guide precedence:
//   1. explicit scope cookie (if it still points at an assigned company)
//   2. auto-scope to their single assignment when they only have one
//   3. null → caller redirects to the picker
//
// Every non-null return runs through assertCompanyAccess before it
// leaves this function — a hard invariant check that this resolver
// is never handing a company user a companyId that isn't theirs.
export async function getEffectiveCompanyId(
  session: Scopeable
): Promise<string | null> {
  const resolved = await resolveCompanyIdInternal(session);
  if (resolved !== null) assertCompanyAccess(session, resolved);
  return resolved;
}

async function resolveCompanyIdInternal(
  session: Scopeable
): Promise<string | null> {
  if (session.profile.company_id) return session.profile.company_id;
  const role = session.profile.role;
  if (role === "system_admin") {
    const cookie = await getScopedCompanyId();
    if (!cookie) return null;
    // Verify the scoped company still exists and isn't soft-deleted.
    // Without this, a sysadmin's cookie can stick to a tenant that
    // was archived + deleted after the scope-in — every subsequent
    // page renders against a ghost (empty pickers, orphan chats,
    // etc.). companies_hide_deleted RLS gives us the check for
    // free: the SELECT returns null when deleted_at is not null.
    //
    // Just returns null on a dead cookie — cookie clearing needs a
    // Server Action or Route Handler (Server Components can't mutate
    // cookies), and every caller of getEffectiveCompanyId already
    // handles null. The next scope-in overwrites the cookie, and
    // scopeIntoCompanyAction refuses to point it at a dead tenant.
    if (!(await companyIsLive(cookie))) return null;
    return cookie;
  }
  if (role === "aims_guide") {
    const assignments = session.profile.guide_company_ids ?? [];
    const cookie = await getScopedCompanyId();
    if (cookie && assignments.includes(cookie)) {
      if (!(await companyIsLive(cookie))) return null;
      return cookie;
    }
    if (assignments.length === 1) {
      if (!(await companyIsLive(assignments[0]))) return null;
      return assignments[0];
    }
    return null;
  }
  return null;
}

// Cheap existence probe. companies_hide_deleted is a restrictive
// SELECT policy, so a soft-deleted company reads back null even
// for a sysadmin. Returns true iff the row is visible + live.
async function companyIsLive(companyId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("companies")
    .select("id")
    .eq("id", companyId)
    .maybeSingle<{ id: string }>();
  return data !== null;
}

export async function setScopedCompanyCookie(
  companyId: string,
  role: Role
): Promise<void> {
  if (role !== "system_admin" && role !== "aims_guide") return;
  const jar = await cookies();
  jar.set(SCOPE_COOKIE_NAME, companyId, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: SCOPE_COOKIE_MAX_AGE,
  });
}

export async function clearScopedCompanyCookie(): Promise<void> {
  const jar = await cookies();
  // Overwrite with an immediately-expired value on the same path so the
  // browser drops it reliably. `jar.delete(name)` doesn't always target
  // path=/ cookies depending on the runtime, hence the explicit set.
  jar.set(SCOPE_COOKIE_NAME, "", {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 0,
  });
}
