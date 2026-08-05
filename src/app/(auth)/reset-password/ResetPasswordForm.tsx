"use client";

import { useEffect, useState } from "react";
import formStyles from "@/components/auth-shell/AuthForm.module.css";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export type ResetPasswordFormProps = {
  submitLabel: string;
  successMessage: string;
  redirectTo: string;
};

// Supabase drops the user here with a recovery session encoded in the
// URL hash. The browser SDK picks it up on mount, but those tokens
// never become request cookies — so the password update has to run
// through the browser client, not a server action. Same pattern as
// AcceptInviteForm.

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

  useEffect(() => {
    setHashError(readHashError());
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
