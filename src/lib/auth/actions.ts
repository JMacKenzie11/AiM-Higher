"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { APP_URL } from "@/lib/supabase/env";

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
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${APP_URL()}/reset-password`,
  });

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
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return {
      ok: false,
      message: "We couldn't set that password. Please try again.",
    };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}
