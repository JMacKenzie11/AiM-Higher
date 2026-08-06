"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { APP_URL } from "@/lib/supabase/env";
import { clearScopedCompanyCookie } from "@/lib/admin/scope";
import { sendResetEmail } from "@/lib/email";
import type { Profile } from "@/lib/types";

// Server actions for auth flows. Every UI form here has a matching
// action; the UI never talks to Supabase directly for these operations.

export type AuthActionResult =
  | { ok: true }
  | { ok: false; message: string };

// ---- Sign in ---------------------------------------------------
export async function signInAction(
  _prev: AuthActionResult | undefined,
  formData: FormData
): Promise<AuthActionResult> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { ok: false, message: "Enter your email and password to continue." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Non-blaming copy per Section 3.
    return {
      ok: false,
      message: "Those details didn't match. Check them and try again.",
    };
  }

  // Every fresh sign-in starts unscoped. System admins land on the
  // company list; any prior scope cookie from an earlier session is
  // dropped so they explicitly re-pick. No effect for company users
  // (they never had a scope cookie to begin with).
  await clearScopedCompanyCookie();

  revalidatePath("/", "layout");
  redirect("/");
}

// ---- Sign out --------------------------------------------------
export async function signOutAction(): Promise<never> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/sign-in");
}

// ---- Request password reset ------------------------------------
// Uses the same admin.generateLink + hashed_token + Resend +
// /auth/callback pattern as invite dispatch (see dispatchInvite in
// src/lib/auth/users.ts), so the entire auth-link surface is
// uniform: no Supabase /verify hop, no PKCE code_verifier race, no
// dependency on Supabase's built-in email service, and every send
// shows up in Resend's dashboard for debuggability.
//
// Always returns { ok: true } — we never leak whether the email
// exists. All failure paths log server-side for triage.
export async function requestPasswordResetAction(
  _prev: AuthActionResult | undefined,
  formData: FormData
): Promise<AuthActionResult> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) {
    return { ok: false, message: "Enter the email tied to your account." };
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: {
      // Not delivered to the user — we build our own /auth/callback
      // link below — but Supabase requires a valid redirectTo, so
      // point it at the real destination as a safety net.
      redirectTo: `${APP_URL()}/reset-password`,
    },
  });

  if (error) {
    console.warn("generateLink(recovery) failed for %s: %s", email, error.message);
    return { ok: true };
  }

  const hashedToken = (
    data as { properties?: { hashed_token?: string } }
  )?.properties?.hashed_token;
  if (!hashedToken) {
    console.warn("generateLink(recovery) returned no hashed_token for %s", email);
    return { ok: true };
  }

  const link =
    `${APP_URL()}/auth/callback` +
    `?token_hash=${encodeURIComponent(hashedToken)}` +
    `&type=recovery` +
    `&next=${encodeURIComponent("/reset-password")}`;

  // Best-effort name lookup so the email addresses them by name.
  // Non-fatal if the profile isn't found (which shouldn't happen
  // once the auth user exists — but we keep the leak-preventing
  // "always return ok" contract regardless).
  const { data: profile } = await admin
    .from("profiles")
    .select("first_name")
    .eq("id", (data as { user?: { id?: string } })?.user?.id ?? "")
    .maybeSingle<Pick<Profile, "first_name">>();

  const sent = await sendResetEmail({
    to: email,
    firstName: profile?.first_name ?? null,
    actionLink: link,
  });

  if (!sent.ok) {
    console.warn("sendResetEmail failed for %s: %s", email, sent.message);
  }

  return { ok: true };
}

// ---- Set a new password (reset OR first-time from invite) ------
export async function setNewPasswordAction(
  _prev: AuthActionResult | undefined,
  formData: FormData
): Promise<AuthActionResult> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 8) {
    return {
      ok: false,
      message: "Choose a password of at least 8 characters.",
    };
  }
  if (password !== confirm) {
    return { ok: false, message: "The two passwords don't match yet." };
  }

  const supabase = await createSupabaseServerClient();

  // If the invite session hasn't yet landed in cookies, updateUser
  // will fail with something like "Auth session missing" — the
  // browser client parsed the URL hash tokens but the SSR helper
  // hasn't seen them on this request. Surface Supabase's own error
  // detail so the user sees what's wrong (weak password, expired
  // session, same-as-previous protection) instead of a blanket
  // "try again."
  const { data, error } = await supabase.auth.updateUser({ password });
  if (error || !data.user) {
    const detail = error?.message?.trim();
    return {
      ok: false,
      message: detail
        ? `We couldn't set that password: ${detail}`
        : "We couldn't set that password. Try refreshing the invite link and try again.",
    };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}
