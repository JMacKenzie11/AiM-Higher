"use client";

import { useActionState } from "react";
import formStyles from "@/components/auth-shell/AuthForm.module.css";
import {
  requestPasswordResetAction,
  type AuthActionResult,
} from "@/lib/auth/actions";

const INITIAL: AuthActionResult = { ok: true };

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(
    requestPasswordResetAction,
    INITIAL
  );

  const submitted = state && "ok" in state && state.ok;
  const errorMessage = state && "ok" in state && !state.ok ? state.message : null;

  if (submitted && !pending) {
    return (
      <p className={formStyles.successMessage} role="status">
        If that email is registered, a reset link is on its way. It works for
        one hour.
      </p>
    );
  }

  return (
    <form className={formStyles.form} action={formAction}>
      <div className={formStyles.field}>
        <label htmlFor="email" className={formStyles.label}>
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className={formStyles.input}
          placeholder="you@company.com"
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
        {pending ? "Sending…" : "Send reset link"}
      </button>
    </form>
  );
}
