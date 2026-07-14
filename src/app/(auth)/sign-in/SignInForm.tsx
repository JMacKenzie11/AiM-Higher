"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import formStyles from "@/components/auth-shell/AuthForm.module.css";
import { signInAction, type AuthActionResult } from "@/lib/auth/actions";

// Sign-in form — wires to signInAction. React 19's useActionState
// gives us free pending state and result plumbing.

const INITIAL: AuthActionResult = { ok: true };

export function SignInForm() {
  const [state, formAction, pending] = useActionState(signInAction, INITIAL);
  const [showPassword, setShowPassword] = useState(false);

  const errorMessage = state && "ok" in state && !state.ok ? state.message : null;

  return (
    <form
      className={formStyles.form}
      action={formAction}
      aria-describedby={errorMessage ? "sign-in-error" : undefined}
    >
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

      <div className={formStyles.field}>
        <label htmlFor="password" className={formStyles.label}>
          Password
        </label>
        <div className={formStyles.passwordWrap}>
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
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

      {errorMessage ? (
        <div id="sign-in-error" role="alert" className={formStyles.errorMessage}>
          <p>{errorMessage}</p>
          <p>
            <Link href="/forgot-password" className={formStyles.inlineLink}>
              Forgot your password?
            </Link>
          </p>
        </div>
      ) : null}

      <button
        type="submit"
        className={formStyles.submit}
        disabled={pending}
        data-loading={pending ? "true" : undefined}
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
