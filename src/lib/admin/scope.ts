import "server-only";

import { cookies } from "next/headers";
import type { Profile, Role } from "@/lib/types";

// System-admin company scoping (Section 7 + 8.9).
//
// A system_admin has no company of their own; when they open a
// specific company from /admin/companies, we stash the company id in
// an HTTP-only cookie so every subsequent request resolves the app
// pages against that company. Team members and company admins ignore
// the cookie entirely — their scope is always their own profile row.
//
// Server actions that mutate this cookie live in scope-actions.ts so
// they can be imported from Client Components.

export const SCOPE_COOKIE_NAME = "aims_scope_company";
export const SCOPE_COOKIE_MAX_AGE = 60 * 60 * 8; // 8 hours

export type Scopeable = {
  profile: Pick<Profile, "id" | "company_id" | "role">;
};

export async function getScopedCompanyId(): Promise<string | null> {
  const jar = await cookies();
  const value = jar.get(SCOPE_COOKIE_NAME)?.value;
  return value && value.length > 0 ? value : null;
}

// Resolves the "current company" for the caller in one place. Every
// company-scoped page (dashboard, plan, weekly-review, etc.) uses
// this to know which company_id to read.
export async function getEffectiveCompanyId(
  session: Scopeable
): Promise<string | null> {
  if (session.profile.company_id) return session.profile.company_id;
  if (session.profile.role !== "system_admin") return null;
  return getScopedCompanyId();
}

export async function setScopedCompanyCookie(
  companyId: string,
  role: Role
): Promise<void> {
  if (role !== "system_admin") return;
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
