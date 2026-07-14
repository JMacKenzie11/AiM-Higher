"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import formStyles from "@/components/auth-shell/AuthForm.module.css";
import {
  setNewPasswordAction,
  type AuthActionResult,
} from "@/lib/auth/actions";
import { acceptInvitationAction } from "@/lib/auth/invitations";

// Two-step accept-invite flow:
//   1. User arrives with a Supabase recovery/invite session already active
//      (the invite email link exchanged for a session in the URL hash).
//   2. They set a password (setNewPasswordAction).
//   3. On success, we immediately call acceptInvitationAction to create
//      their profile row from the invitation.

const INITIAL: AuthActionResult = { ok: true };

export function AcceptInviteForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(
    setNewPasswordAction,
    INITIAL
  );
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [accepting, startAccept] = useTransition();
  const [accepted, setAccepted] = useState(false);
  const router = useRouter();

  const errorMessage = state && "ok" in state && !state.ok ? state.message : null;
  const passwordSet = state && "ok" in state && state.ok && !pending;

  if (passwordSet && !accepted && !accepting && !acceptError) {
    startAccept(async () => {
      const result = await acceptInvitationAction(token);
      if (!result.ok) {
        setAcceptError(result.message);
        return;
      }
      setAccepted(true);
      setTimeout(() => router.push("/"), 900);
    });
  }

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
