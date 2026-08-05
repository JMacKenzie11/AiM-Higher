"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import formStyles from "@/components/auth-shell/AuthForm.module.css";
import {
  setNewPasswordAction,
  type AuthActionResult,
} from "@/lib/auth/actions";
import { acceptInviteAction } from "@/lib/auth/users";

// Two-step accept-invite flow:
//   1. User arrives with a Supabase invite session already active
//      (the invite email link exchanged for a session in the URL hash).
//   2. They set a password (setNewPasswordAction).
//   3. On success, acceptInviteAction flips their existing profile row
//      from pending → active.

// Initial state must be "not yet submitted" — the previous default
// of { ok: true } made passwordSet true on the very first render,
// which fired acceptInviteAction before the user had typed a
// password. Under Safari that spun the tab into an OOM kill.
const INITIAL: AuthActionResult = { ok: false, message: "" };

export function AcceptInviteForm() {
  const [state, formAction, pending] = useActionState(
    setNewPasswordAction,
    INITIAL
  );
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [accepting, startAccept] = useTransition();
  const [accepted, setAccepted] = useState(false);

  const errorMessage = state && "ok" in state && !state.ok && state.message
    ? state.message
    : null;
  const passwordSet = state && "ok" in state && state.ok && !pending;

  // Fire the profile flip inside an effect, not during render. Guards
  // ensure a single call: only when the password action just returned
  // ok, and we haven't already accepted / errored / started.
  useEffect(() => {
    if (!passwordSet || accepted || accepting || acceptError) return;
    startAccept(async () => {
      const result = await acceptInviteAction();
      if (!result.ok) {
        setAcceptError(result.message);
        return;
      }
      setAccepted(true);
      // Full-page navigate — the accept action just flipped the
      // profile row from pending → active and Supabase set fresh
      // auth cookies. router.push() would use the stale RSC
      // prefetch cache from before authentication, which shows the
      // shell but breaks subsequent client-side link clicks until a
      // hard refresh. window.location resets everything cleanly.
      setTimeout(() => {
        window.location.href = "/dashboard";
      }, 900);
    });
  }, [passwordSet, accepted, accepting, acceptError]);

  if (accepted) {
    return (
      <p className={formStyles.successMessage} role="status">
        You&rsquo;re in. Taking you to your dashboard…
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

  return (
    <form className={formStyles.form} action={formAction}>
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
            className={formStyles.input}
            disabled={pending || accepting}
          />
          <button
            type="button"
            className={formStyles.reveal}
            onClick={() => setShowPassword((prev) => !prev)}
            aria-pressed={showPassword}
            aria-label={showPassword ? "Hide password" : "Show password"}
            disabled={pending || accepting}
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
          className={formStyles.input}
          disabled={pending || accepting}
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
        disabled={pending || accepting}
        data-loading={pending || accepting ? "true" : undefined}
      >
        {pending || accepting ? "Setting up…" : "Accept invitation"}
      </button>
    </form>
  );
}
