"use client";

import { useActionState, useState } from "react";
import formStyles from "@/components/auth-shell/AuthForm.module.css";
import {
  completeResetPasswordAction,
  type CompleteResetResult,
} from "@/lib/auth/actions";
import { PasswordRequirements } from "@/components/auth-shell/PasswordRequirements";

// Token-as-form-submit reset flow. Token stays in the URL until
// the user submits their new password — same pattern as the invite
// flow, same reason: scanners / link previewers can't burn the
// one-shot OTP token by just following the URL.

const INITIAL: CompleteResetResult = { ok: false, message: "" };

export function ResetPasswordForm({
  tokenHash,
  type,
}: {
  tokenHash: string | null;
  type: string | null;
}) {
  const [state, formAction, pending] = useActionState<
    CompleteResetResult,
    FormData
  >(completeResetPasswordAction, INITIAL);

  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  if (!tokenHash || !type) {
    return (
      <p role="alert" className={formStyles.errorMessage}>
        This reset link is missing its token. Request a new one from
        the sign-in page.
      </p>
    );
  }

  if (state && "ok" in state && !state.ok && "expired" in state && state.expired) {
    return (
      <p role="alert" className={formStyles.errorMessage}>
        {state.message} Request a new one from the sign-in page.
      </p>
    );
  }

  if (state && "ok" in state && state.ok) {
    if (typeof window !== "undefined") {
      setTimeout(() => {
        window.location.href = "/";
      }, 900);
    }
    return (
      <p className={formStyles.successMessage} role="status">
        Password updated. Taking you to the app…
      </p>
    );
  }

  const errorMessage =
    state && "ok" in state && !state.ok && state.message ? state.message : null;

  return (
    <form action={formAction} className={formStyles.form}>
      <input type="hidden" name="token_hash" value={tokenHash} />
      <input type="hidden" name="type" value={type} />

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
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={formStyles.input}
          disabled={pending}
        />
      </div>

      <PasswordRequirements password={password} confirm={confirm} />

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
        {pending ? "Saving…" : "Save password"}
      </button>
    </form>
  );
}
