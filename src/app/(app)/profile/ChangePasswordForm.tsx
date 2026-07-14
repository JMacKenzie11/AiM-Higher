"use client";

import { useActionState, useState } from "react";
import {
  setNewPasswordAction,
  type AuthActionResult,
} from "@/lib/auth/actions";
import styles from "./profile.module.css";

const INITIAL: AuthActionResult = { ok: true };

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState(
    setNewPasswordAction,
    INITIAL
  );
  const [showPassword, setShowPassword] = useState(false);

  const errorMessage =
    state && "ok" in state && !state.ok ? state.message : null;
  const success = state && "ok" in state && state.ok && !pending;

  return (
    <form action={formAction} className={styles.form}>
      <div className={styles.field}>
        <label htmlFor="new-password" className={styles.label}>
          New password
        </label>
        <div className={styles.passwordWrap}>
          <input
            id="new-password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            minLength={8}
            required
            className={styles.input}
            disabled={pending}
          />
          <button
            type="button"
            className={styles.reveal}
            onClick={() => setShowPassword((prev) => !prev)}
            aria-pressed={showPassword}
            aria-label={showPassword ? "Hide password" : "Show password"}
            disabled={pending}
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
      </div>

      <div className={styles.field}>
        <label htmlFor="new-password-confirm" className={styles.label}>
          Confirm new password
        </label>
        <input
          id="new-password-confirm"
          name="confirm"
          type={showPassword ? "text" : "password"}
          autoComplete="new-password"
          minLength={8}
          required
          className={styles.input}
          disabled={pending}
        />
      </div>

      {errorMessage ? (
        <p role="alert" className={styles.errorMessage}>
          {errorMessage}
        </p>
      ) : null}

      {success ? (
        <p role="status" className={styles.successMessage}>
          Password updated.
        </p>
      ) : null}

      <div className={styles.submitRow}>
        <button
          type="submit"
          className={styles.primaryButton}
          disabled={pending}
        >
          {pending ? "Saving…" : "Update password"}
        </button>
      </div>
    </form>
  );
}
