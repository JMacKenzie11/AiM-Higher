import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Profile, Role } from "@/lib/types";

// Server-side helpers to look up the current user + profile, and to
// enforce role checks. The spec (Section 2) requires every authorization
// rule to be enforced twice — server layer AND RLS. These helpers are
// the server layer.

export async function getCurrentUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

// A SessionProfile is a DB Profile plus the caller's guide
// assignments loaded eagerly. Non-guides always get an empty array;
// guides get the full list of company_ids they've been assigned to.
// Attaching this to the session keeps isAdminForCompany() sync — no
// DB round trip in every permission check.
export type SessionProfile = Profile & {
  guide_company_ids: readonly string[];
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
  const supabase = await createSupabaseServerClient();
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

  return {
    userId: user.id,
    email: user.email ?? "",
    profile: profile
      ? { ...profile, guide_company_ids: guideCompanyIds }
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
