"use client";

import { useEffect, useState } from "react";
import type { EmailOtpType } from "@supabase/supabase-js";
import formStyles from "@/components/auth-shell/AuthForm.module.css";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export type ResetPasswordFormProps = {
  submitLabel: string;
  successMessage: string;
  redirectTo: string;
};

// Supabase drops the user here with a recovery session encoded in
// one of three URL shapes:
//   a. #access_token=…&refresh_token=…  (implicit — legacy)
//   b. ?code=…                          (PKCE)
//   c. ?token_hash=…&type=recovery      (OTP hash — modern default)
// supabase-js auto-handles (a) and sometimes (b); (c) must be
// exchanged explicitly via verifyOtp. Same bootstrap as AcceptInviteForm.
// The password update itself runs through the browser client because
// those tokens never become request cookies a server action could see.

function readHashError(): string | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  const code = params.get("error_code");
  const desc = params.get("error_description");
  if (!code && !desc) return null;
  if (code === "otp_expired") {
    return "This reset link has expired or has already been used. Request a new one from the sign-in page.";
  }
  return desc ? desc.replace(/\+/g, " ") : "This reset link is invalid.";
}

export function ResetPasswordForm({
  submitLabel,
  successMessage,
  redirectTo,
}: ResetPasswordFormProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  const [hashError, setHashError] = useState<string | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    const err = readHashError();
    if (err) {
      setHashError(err);
      setCheckingSession(false);
      return;
    }

    // Snapshot + strip query params up front so a re-mount (React
    // strict-mode double-invoke in dev, back/forward navigations)
    // can't try to re-consume a one-shot token — the second call
    // fails and would poison an already-good session.
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const tokenHash = url.searchParams.get("token_hash");
    const type = url.searchParams.get("type");
    if (code || tokenHash) {
      window.history.replaceState({}, "", window.location.pathname);
    }

    let cancelled = false;
    (async () => {
      const supabase = createSupabaseBrowserClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) {
        if (!cancelled) setCheckingSession(false);
        return;
      }

      let exchangeErr: string | null = null;
      if (tokenHash && type) {
        const { error } = await supabase.auth.verifyOtp({
          type: type as EmailOtpType,
          token_hash: tokenHash,
        });
        if (error) exchangeErr = error.message;
      } else if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) exchangeErr = error.message;
      }

      if (cancelled) return;
      if (exchangeErr) {
        setHashError(
          "This reset link is invalid or has expired. Request a new one from the sign-in page."
        );
      }
      setCheckingSession(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!succeeded) return;
    // Full-page navigate — router.push() would reuse the pre-auth
    // RSC prefetch cache and break link clicks until a hard refresh.
    const t = setTimeout(() => {
      window.location.href = redirectTo;
    }, 900);
    return () => clearTimeout(t);
  }, [succeeded, redirectTo]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrorMessage(null);
    if (password.length < 8) {
      setErrorMessage("Choose a password of at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setErrorMessage("The two passwords don't match yet.");
      return;
    }
    setSubmitting(true);
    const supabase = createSupabaseBrowserClient();
    const { data, error } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (error || !data.user) {
      const detail = error?.message?.trim();
      setErrorMessage(
        detail
          ? `We couldn't set that password: ${detail}`
          : "We couldn't set that password. Try refreshing the page and try again."
      );
      return;
    }
    setSucceeded(true);
  }

  if (hashError) {
    return (
      <p role="alert" className={formStyles.errorMessage}>
        {hashError}
      </p>
    );
  }

  if (succeeded) {
    return (
      <p className={formStyles.successMessage} role="status">
        {successMessage}
      </p>
    );
  }

  if (checkingSession) {
    return (
      <p className={formStyles.helperText} role="status">
        Verifying your reset link…
      </p>
    );
  }

  return (
    <form className={formStyles.form} onSubmit={handleSubmit}>
      <div className={formStyles.field}>
        <label htmlFor="password" className={formStyles.label}>
          New password
        </label>
        <div className={formStyles.passwordWrap}>
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            minLength={8}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={formStyles.input}
            disabled={submitting}
          />
          <button
            type="button"
            className={formStyles.reveal}
            onClick={() => setShowPassword((prev) => !prev)}
            aria-pressed={showPassword}
            aria-label={showPassword ? "Hide password" : "Show password"}
            disabled={submitting}
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
      </div>

      <div className={formStyles.field}>
        <label htmlFor="confirm" className={formStyles.label}>
          Confirm new password
        </label>
        <input
          id="confirm"
          name="confirm"
          type={showPassword ? "text" : "password"}
          autoComplete="new-password"
          minLength={8}
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={formStyles.input}
          disabled={submitting}
        />
      </div>

      {errorMessage ? (
        <p role="alert" className={formStyles.errorMessage}>
          {errorMessage}
        </p>
      ) : null}

      <button
        type="submit"
        className={formStyles.submit}
        disabled={submitting}
        data-loading={submitting ? "true" : undefined}
      >
        {submitting ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
