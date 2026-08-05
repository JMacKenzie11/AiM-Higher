"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { APP_URL } from "@/lib/supabase/env";
import { clearScopedCompanyCookie } from "@/lib/admin/scope";

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
export async function requestPasswordResetAction(
  _prev: AuthActionResult | undefined,
  formData: FormData
): Promise<AuthActionResult> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) {
    return { ok: false, message: "Enter the email tied to your account." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${APP_URL()}/reset-password`,
  });

  // Log server-side so email delivery problems (rate limits, SMTP
  // misconfig, redirectTo not on the allow-list) are debuggable —
  // Supabase returns success even when the email itself won't be
  // dispatched, and we still want to avoid leaking existence to
  // the caller. Vercel logs will surface this.
  if (error) {
    console.warn(
      "resetPasswordForEmail returned error for %s: %s",
      email,
      error.message
    );
  }

  // Always return success to avoid leaking which emails exist.
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
