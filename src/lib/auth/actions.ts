"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { APP_URL } from "@/lib/supabase/env";
import { clearScopedCompanyCookie } from "@/lib/admin/scope";
import { sendResetEmail } from "@/lib/email";
import { trackAfter } from "@/lib/analytics/track";
import type { Profile } from "@/lib/types";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

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

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

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

  const userId = data?.user?.id;
  if (userId) {
    trackAfter(userId, "user.signed_in", { method: "password" });
  }

  revalidatePath("/", "layout");
  redirect("/");
}

// ---- Sign out --------------------------------------------------
export async function signOutAction(): Promise<never> {
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
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

  const admin = createSupabaseAdminClient(getCurrentInstanceConfig());
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

  // Link points DIRECTLY at /reset-password with the token in the
  // query, not at /auth/callback. verifyOtp only fires when the
  // user submits the password form, so link previewers / scanners
  // (Microsoft SafeLinks, iMessage LinkPresentation, Slack unfurl)
  // that GET the URL never consume the token. Same pattern used
  // by GitHub / Google / most modern SaaS.
  const link =
    `${APP_URL()}/reset-password` +
    `?token_hash=${encodeURIComponent(hashedToken)}` +
    `&type=recovery`;

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

// ---- Complete accept-invite (verify OTP + set password + activate)
// Called from AcceptInviteForm on submit. Runs the full sequence in
// one server action so the token is only exchanged when a human has
// typed a password — link previewers / scanners that just GET the
// invite URL never trigger verifyOtp, so they can't burn the
// one-shot token. This is the GitHub / Google / modern SaaS
// pattern: token-as-form-submit, not exchange-on-arrival.
export type CompleteAcceptResult =
  | { ok: true }
  | { ok: false; message: string; expired?: boolean };

export async function completeAcceptInviteAction(
  _prev: CompleteAcceptResult | undefined,
  formData: FormData
): Promise<CompleteAcceptResult> {
  const tokenHash = String(formData.get("token_hash") ?? "").trim();
  const type = String(formData.get("type") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (!tokenHash || !type) {
    return {
      ok: false,
      message: "This link is missing its invitation token.",
      expired: true,
    };
  }
  if (password.length < 8) {
    return {
      ok: false,
      message: "Choose a password of at least 8 characters.",
    };
  }
  if (password !== confirm) {
    return { ok: false, message: "The two passwords don't match yet." };
  }

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());

  // Step 1: exchange the token. Sets the session cookie for this
  // request; the next call (updateUser) uses it.
  const { data: otpData, error: otpErr } = await supabase.auth.verifyOtp({
    type: type as EmailOtpType,
    token_hash: tokenHash,
  });
  if (otpErr || !otpData.session) {
    return {
      ok: false,
      message:
        otpErr?.message ??
        "This invite link is invalid or has expired.",
      expired: true,
    };
  }

  // Step 2: set the password on the newly-signed-in user.
  const { error: pwErr } = await supabase.auth.updateUser({ password });
  if (pwErr) {
    return {
      ok: false,
      message: `We couldn't set that password: ${pwErr.message}`,
    };
  }

  // Step 3: flip the profile from pending → active. Idempotent —
  // safe if the row is already active (returning user re-clicking
  // an old link during setup). Non-fatal on failure: verifyOtp +
  // updateUser already succeeded so the user IS in and can sign in;
  // we log so a sysadmin can inspect + flip the row manually. This
  // was the failure mode where Jeff Bouwman signed in but stayed
  // pending on 2026-08-08 — we silently swallowed the update result.
  const admin = createSupabaseAdminClient(getCurrentInstanceConfig());
  const { error: statusErr } = await admin
    .from("profiles")
    .update({ status: "active" })
    .eq("id", otpData.session.user.id);
  if (statusErr) {
    console.error("completeAcceptInvite: profile activation failed", {
      userId: otpData.session.user.id,
      error: statusErr.message,
      code: (statusErr as { code?: string }).code,
    });
  } else {
    console.log("completeAcceptInvite: activated profile", {
      userId: otpData.session.user.id,
    });
  }

  revalidatePath("/", "layout");
  const acceptedUserId = otpData.session.user.id;
  trackAfter(acceptedUserId, "invite.accepted", {});
  return { ok: true };
}

// ---- Complete reset-password (verify OTP + set password) --------
// Same token-as-form-submit pattern as completeAcceptInviteAction.
// No profile status flip — the user is already active.
export type CompleteResetResult =
  | { ok: true }
  | { ok: false; message: string; expired?: boolean };

export async function completeResetPasswordAction(
  _prev: CompleteResetResult | undefined,
  formData: FormData
): Promise<CompleteResetResult> {
  const tokenHash = String(formData.get("token_hash") ?? "").trim();
  const type = String(formData.get("type") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (!tokenHash || !type) {
    return {
      ok: false,
      message: "This link is missing its reset token.",
      expired: true,
    };
  }
  if (password.length < 8) {
    return {
      ok: false,
      message: "Choose a password of at least 8 characters.",
    };
  }
  if (password !== confirm) {
    return { ok: false, message: "The two passwords don't match yet." };
  }

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data: otpData, error: otpErr } = await supabase.auth.verifyOtp({
    type: type as EmailOtpType,
    token_hash: tokenHash,
  });
  if (otpErr || !otpData.session) {
    return {
      ok: false,
      message: otpErr?.message ?? "This reset link is invalid or has expired.",
      expired: true,
    };
  }

  const { error: pwErr } = await supabase.auth.updateUser({ password });
  if (pwErr) {
    return {
      ok: false,
      message: `We couldn't set that password: ${pwErr.message}`,
    };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

// ---- Legacy: set-new-password from an already-established session
// Kept for the reset-password client-side fallback path that runs
// against old-style hash-token URLs still sitting in inboxes. New
// links use completeResetPasswordAction above.
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

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
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
