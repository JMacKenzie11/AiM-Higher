import "server-only";

import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Profile, Role } from "@/lib/types";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

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
  // home_company_id is optional, and deliberately. It was required for
  // one revision of this change, which pulled it into
  // SessionProfileLike and then GateProfile and then their tests: a
  // landing preference spreading through types that have nothing to do
  // with landing. It earns none of that, because the worst an absent
  // one can do is resolve null, which is what this function returned
  // before the column existed. Real callers pass a whole profile row,
  // and the loader selects `*`, so they carry it without being asked.
  profile: Pick<Profile, "id" | "company_id" | "role"> & {
    home_company_id?: string | null;
    guide_company_ids?: readonly string[];
  };
};

// THE COOKIE IS BOUND TO THE USER IT WAS ISSUED FOR.
//
// Stored as `<profileId>:<companyId>`, and read back only when the
// profile id matches the caller. A scope belonging to somebody else is
// not a scope; it is a cookie left in a browser.
//
// WHY, AND IT IS NOT HYPOTHETICAL. Found on production 2026-09-14: a
// newly created portfolio_admin signed in and landed directly inside a
// company's dashboard, having never pressed a scope-in control, with
// no row in portfolio_admin_events to say they had entered.
//
// The cookie was the previous session's. It is path=/ with an 8-hour
// life, and only TWO code paths ever cleared it: signInAction and
// exitCompanyScopeAction. Signing OUT did not, and neither did
// accepting an invite — which creates a brand-new session for a
// DIFFERENT user through verifyOtp, in the same browser, with the
// previous user's scope still sitting there. getEffectiveCompanyId
// then read it back and handed the new account a tenant nobody had
// chosen for them.
//
// Adding a third and fourth clear() call would have closed those two
// doors. Binding closes the class: it does not matter which auth path
// created the session, or which ones remember to tidy up, because a
// cookie issued to one profile cannot resolve for another.
//
// The scope-in ACTION remains the only thing that writes this, and the
// only thing that records an entry. That was always the intent; this
// is what makes it true regardless of what else a browser is holding.
function splitScopeCookie(raw: string | undefined): {
  profileId: string;
  companyId: string;
} | null {
  if (!raw) return null;
  const at = raw.indexOf(":");
  // No separator means a cookie written before this change. Treated as
  // unusable rather than as a bare company id: an unbound cookie is
  // exactly the thing this function exists to stop honouring, and the
  // cost of refusing it is one re-pick per operator, once.
  if (at <= 0) return null;
  const profileId = raw.slice(0, at);
  const companyId = raw.slice(at + 1);
  if (!profileId || !companyId) return null;
  return { profileId, companyId };
}

// The company id this cookie carries, or null when it carries none,
// is malformed, is unbound, or belongs to somebody else.
export function scopedCompanyIdForProfile(
  raw: string | undefined,
  profileId: string
): string | null {
  const parsed = splitScopeCookie(raw);
  if (!parsed) return null;
  return parsed.profileId === profileId ? parsed.companyId : null;
}

export async function getScopedCompanyId(
  profileId: string
): Promise<string | null> {
  const jar = await cookies();
  return scopedCompanyIdForProfile(jar.get(SCOPE_COOKIE_NAME)?.value, profileId);
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
// - portfolio_admin: bypass unconditionally. Their scope is the
//   instance, so every company in this database is in it, including
//   ones created after they were granted the role. There is no
//   assignment list to consult — that absence is the design (0190),
//   and portfolio_admin_events is what stands in for it.
// - aims_guide: allowed iff the target is in their assignments.
// - company_admin / team_member: MUST match profile.company_id.
export function assertCompanyAccess(
  session: Scopeable,
  targetCompanyId: string
): void {
  const { role, company_id } = session.profile;
  if (role === "system_admin") return;
  if (role === "portfolio_admin") return;
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
  if (role === "system_admin" || role === "portfolio_admin") {
    const cookie = await getScopedCompanyId(session.profile.id);
    // Verify the scoped company still exists and isn't soft-deleted.
    // Without this, a sysadmin's cookie can stick to a tenant that
    // was archived + deleted after the scope-in — every subsequent
    // page renders against a ghost (empty pickers, orphan chats,
    // etc.). companies_hide_deleted RLS gives us the check for
    // free: the SELECT returns null when deleted_at is not null.
    //
    // Cookie clearing needs a Server Action or Route Handler (Server
    // Components can't mutate cookies), and every caller of
    // getEffectiveCompanyId already handles null. The next scope-in
    // overwrites the cookie, and scopeIntoCompanyAction refuses to
    // point it at a dead tenant.
    if (cookie && (await companyIsLive(cookie))) return cookie;

    // HOME, and only after the cookie. Added 0200.
    //
    // APPENDED, NOT REORDERED, and that distinction is the reason
    // this change is small. The original design put home in
    // `company_id`, which is read at the top of this function — so a
    // portfolio admin would have been pinned to their home and
    // silently stopped being a portfolio admin in the UI while still
    // holding the role. Home lives in its own column instead, so the
    // branch above is untouched and this is a final fallback.
    //
    // It grants nothing. assertCompanyAccess still runs on whatever
    // comes back, and for these two roles it bypasses because their
    // scope is already the instance — landing somewhere is not
    // permission to write there, which portfolio_assignments decides
    // and the harness asserts separately.
    //
    // Null for everyone today, so this returns exactly what it
    // returned before until somebody sets one.
    const home = session.profile.home_company_id ?? null;
    if (home && (await companyIsLive(home))) return home;
    return null;
  }
  if (role === "aims_guide") {
    const assignments = session.profile.guide_company_ids ?? [];
    const cookie = await getScopedCompanyId(session.profile.id);
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
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data } = await supabase
    .from("companies")
    .select("id")
    .eq("id", companyId)
    .maybeSingle<{ id: string }>();
  return data !== null;
}

export async function setScopedCompanyCookie(
  companyId: string,
  role: Role,
  // The profile this scope belongs to. Required: a cookie that does
  // not say who it is for is the bug this signature exists to prevent,
  // and making it optional would let a caller re-create it by
  // forgetting an argument.
  profileId: string
): Promise<void> {
  if (
    role !== "system_admin" &&
    role !== "aims_guide" &&
    role !== "portfolio_admin"
  ) {
    return;
  }
  const jar = await cookies();
  jar.set(SCOPE_COOKIE_NAME, `${profileId}:${companyId}`, {
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
