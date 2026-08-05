"use client";

import { useEffect, useState, useTransition } from "react";
import formStyles from "@/components/auth-shell/AuthForm.module.css";
import { acceptInviteAction } from "@/lib/auth/users";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

// Two-step accept-invite flow:
//   1. User arrives with a Supabase invite session already active
//      via URL hash tokens; the Supabase browser client picks them
//      up on mount (detectSessionInUrl: true) and stores the session
//      in memory + cookies.
//   2. They set a password. This has to happen through the BROWSER
//      Supabase client — the URL-hash session isn't in the request
//      cookies the server action would see, so a server-side
//      updateUser fails with "Auth session missing!" on the fresh
//      link's first submit.
//   3. On success, acceptInviteAction (server action) flips the
//      pending profile row to active.

// Supabase surfaces token failures via the URL hash
// (#error=access_denied&error_code=otp_expired&...). Detect it on
// mount so a dead link renders a friendly explanation instead of a
// form that will silently fail on submit.
function readHashError(): string | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  const code = params.get("error_code");
  const desc = params.get("error_description");
  if (!code && !desc) return null;
  if (code === "otp_expired") {
    return "This invite link has expired or has already been used. Ask whoever added you to send a fresh invitation.";
  }
  return desc ? desc.replace(/\+/g, " ") : "This invite link is invalid.";
}

export function AcceptInviteForm() {
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [passwordSet, setPasswordSet] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [accepting, startAccept] = useTransition();
  const [accepted, setAccepted] = useState(false);
  const [hashError, setHashError] = useState<string | null>(null);

  useEffect(() => {
    setHashError(readHashError());
  }, []);

  // Fire the profile flip inside an effect, not during render. Only
  // when the password update just returned ok and we haven't already
  // moved on.
  useEffect(() => {
    if (!passwordSet || accepted || accepting || acceptError) return;
    startAccept(async () => {
      const result = await acceptInviteAction();
      if (!result.ok) {
        setAcceptError(result.message);
        return;
      }
      setAccepted(true);
      // Full-page navigate — Supabase set fresh auth cookies and the
      // acceptAction flipped the profile row. router.push() would
      // reuse stale RSC prefetch payloads from the pre-auth session
      // and break subsequent link clicks until a hard refresh.
      setTimeout(() => {
        window.location.href = "/dashboard";
      }, 900);
    });
  }, [passwordSet, accepted, accepting, acceptError]);

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
    setPasswordSet(true);
  }

  if (accepted) {
    return (
      <p className={formStyles.successMessage} role="status">
        You&rsquo;re in. Taking you to your dashboard…
      </p>
    );
  }

  if (hashError) {
    return (
      <p role="alert" className={formStyles.errorMessage}>
        {hashError}
      </p>
    );
  }

  if (acceptError) {
    return (
      <p role="alert" className={formStyles.errorMessage}>
        {acceptError}
      </p>
    );
  }

  const busy = submitting || accepting;

  return (
    <form className={formStyles.form} onSubmit={handleSubmit}>
      <div className={formStyles.field}>
        <label htmlFor="password" className={formStyles.label}>
          Choose a password
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
            disabled={busy}
          />
          <button
            type="button"
            className={formStyles.reveal}
            onClick={() => setShowPassword((prev) => !prev)}
            aria-pressed={showPassword}
            aria-label={showPassword ? "Hide password" : "Show password"}
            disabled={busy}
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
      </div>

      <div className={formStyles.field}>
        <label htmlFor="confirm" className={formStyles.label}>
          Confirm password
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
          disabled={busy}
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
        disabled={busy}
        data-loading={busy ? "true" : undefined}
      >
        {busy ? "Setting up…" : "Accept invitation"}
      </button>
    </form>
  );
}
