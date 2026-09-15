import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Profile, Role } from "@/lib/types";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

// Server-side helpers to look up the current user + profile, and to
// enforce role checks. The spec (Section 2) requires every authorization
// rule to be enforced twice — server layer AND RLS. These helpers are
// the server layer.

export async function getCurrentUser() {
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

// A SessionProfile is a DB Profile plus the caller's assignments
// loaded eagerly. Roles that cannot hold a given kind always get an
// empty array. Attaching these to the session keeps
// isAdminForCompany() sync — no DB round trip in every permission
// check.
//
// TWO LISTS, NOT ONE, and they are not merged. They mean the same
// thing to the write gate and different things everywhere else: the
// roster badge has to say PORTFOLIO or AIMS GUIDE, and decision 5
// makes a portfolio admin's assignment unrevocable by the company
// while decision 7 makes a guide's revocable. A merged list would
// answer the permission question and lose both of those.
export type SessionProfile = Profile & {
  guide_company_ids: readonly string[];
  portfolio_company_ids: readonly string[];
};

export type CurrentSession = {
  userId: string;
  email: string;
  profile: SessionProfile | null;
};

// Wrapped in React's cache() so the whole auth resolution — the
// getUser() round trip to GoTrue, the profiles read, and the guide
// assignments read — happens ONCE per request instead of once per
// caller. Middleware, the (app) layout and the page each call
// requireProfile independently; a server action adds a fourth as the
// tree re-renders. getUser() is not a local token decode, it's an
// HTTPS call that revalidates against the auth server every time, so
// the duplicates were the single most repeated round trip in the app.
//
// cache() is per-request and per-render, so there's no cross-request
// or cross-user leakage: two different users' requests never share an
// entry. Nothing else changes — requireSession, requireProfile and
// requireRole all funnel through here.
export const getCurrentSession = cache(async function getCurrentSession(): Promise<CurrentSession | null> {
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle<Profile>();

  let guideCompanyIds: string[] = [];
  if (profile?.role === "aims_guide") {
    const { data: assignments } = await supabase
      .from("guide_assignments")
      .select("company_id")
      .eq("guide_id", profile.id);
    guideCompanyIds = ((assignments ?? []) as Array<{ company_id: string }>).map(
      (a) => a.company_id
    );
  }

  // Read through the caller's own client, so the row-level policy is
  // what decides. portfolio_assignments_select (0199) admits the
  // system_admin and the assignment's own holder, which is exactly
  // the set that should be able to build this list.
  let portfolioCompanyIds: string[] = [];
  if (profile?.role === "portfolio_admin") {
    const { data: assignments } = await supabase
      .from("portfolio_assignments")
      .select("company_id")
      .eq("portfolio_admin_id", profile.id);
    portfolioCompanyIds = (
      (assignments ?? []) as Array<{ company_id: string }>
    ).map((a) => a.company_id);
  }

  return {
    userId: user.id,
    email: user.email ?? "",
    profile: profile
      ? {
          ...profile,
          guide_company_ids: guideCompanyIds,
          portfolio_company_ids: portfolioCompanyIds,
        }
      : null,
  };
});

// Redirects to /sign-in if there is no session. Returns the session
// object otherwise. For pages that require an established profile
// (i.e. accepted invitation), use requireProfile below.
export async function requireSession(): Promise<CurrentSession> {
  const session = await getCurrentSession();
  if (!session) redirect("/sign-in");
  return session;
}

export async function requireProfile(): Promise<
  CurrentSession & { profile: SessionProfile }
> {
  const session = await requireSession();
  if (!session.profile) {
    // Signed in but no profile row: happens if seed didn't run, or if
    // an invited user finished /accept-invite but the profile insert
    // failed. Send them back to sign-in — they need admin help.
    redirect("/sign-in?error=no-profile");
  }
  return session as CurrentSession & { profile: SessionProfile };
}

export async function requireRole(
  allowed: Role[]
): Promise<CurrentSession & { profile: SessionProfile }> {
  const session = await requireProfile();
  if (!allowed.includes(session.profile.role)) {
    redirect("/");
  }
  return session;
}
