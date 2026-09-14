"use client";

import { useActionState } from "react";
import formStyles from "@/components/auth-shell/AuthForm.module.css";
import {
  requestPasswordResetAction,
  type AuthActionResult,
} from "@/lib/auth/actions";

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState<
    AuthActionResult | undefined,
    FormData
  >(requestPasswordResetAction, undefined);

  const submitted = state?.ok === true;
  const errorMessage = state && !state.ok ? state.message : null;

  // The address is repeated back, and that is the whole change.
  //
  // On 2026-09-14 a reset was requested for `jasonm@mandown.tools`
  // when the account is `jason@mandown.tools`. Everything behaved
  // correctly: GoTrue said "User with this email not found", the
  // action swallowed it to avoid confirming whether an address is
  // registered, and this screen said a link was on its way. The typo
  // was invisible for half an hour.
  //
  // Echoing it leaks nothing — the reader typed it a second ago — and
  // a wrong address is obvious the moment it is shown back.
  const submittedEmail = state?.ok === true ? state.email : undefined;

  if (submitted && !pending) {
    return (
      <p className={formStyles.successMessage} role="status">
        If <strong>{submittedEmail ?? "that email"}</strong> is registered, a
        reset link is on its way. It works for one hour. Check the address
        above if nothing arrives.
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
