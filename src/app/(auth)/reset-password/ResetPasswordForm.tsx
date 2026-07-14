"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import formStyles from "@/components/auth-shell/AuthForm.module.css";
import {
  setNewPasswordAction,
  type AuthActionResult,
} from "@/lib/auth/actions";

const INITIAL: AuthActionResult = { ok: true };

export type ResetPasswordFormProps = {
  submitLabel: string;
  successMessage: string;
  redirectTo: string;
};

// Shared form used by /reset-password and by the /accept-invite step 2.
// On success, redirects to `redirectTo` (the app root, which then goes
// through the role-based redirect).
export function ResetPasswordForm({
  submitLabel,
  successMessage,
  redirectTo,
}: ResetPasswordFormProps) {
  const [state, formAction, pending] = useActionState(
    setNewPasswordAction,
    INITIAL
  );
  const [showPassword, setShowPassword] = useState(false);
  const router = useRouter();

  const succeeded = state && "ok" in state && state.ok && !pending;
  const errorMessage = state && "ok" in state && !state.ok ? state.message : null;

  if (succeeded) {
    // ASSUMPTION: brief pause so the success message is legible before
    // the redirect fires. Keeps the "celebrate progress" voice.
    setTimeout(() => router.push(redirectTo), 900);
    return (
      <p className={formStyles.successMessage} role="status">
        {successMessage}
      </p>
    );
  }

  return (
    <form className={formStyles.form} action={formAction}>
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
            className={formStyles.input}
            disabled={pending}
          />
          <button
            type="button"
            className={formStyles.reveal}
            onClick={() => setShowPassword((prev) => !prev)}
            aria-pressed={showPassword}
            aria-label={showPassword ? "Hide password" : "Show password"}
            disabled={pending}
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
          className={formStyles.input}
          disabled={pending}
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
        disabled={pending}
        data-loading={pending ? "true" : undefined}
      >
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
