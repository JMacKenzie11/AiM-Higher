"use client";

import { useActionState, useState, useTransition } from "react";
import formStyles from "@/components/auth-shell/AuthForm.module.css";
import {
  completeAcceptInviteAction,
  type CompleteAcceptResult,
} from "@/lib/auth/actions";
import { requestFreshInviteAction } from "@/lib/auth/users";
import { PasswordRequirements } from "@/components/auth-shell/PasswordRequirements";

// Token-as-form-submit invite flow. The link puts the OTP token in
// the URL; we render the password form immediately without touching
// the token. Only when the user submits does the server action run
// verifyOtp + updateUser + profile status flip in one atomic step.
// Link previewers / scanners that GET the URL never trigger the
// exchange, so they can't burn the one-shot token — the GitHub /
// Google / modern SaaS pattern.

const INITIAL: CompleteAcceptResult = { ok: false, message: "" };

export function AcceptInviteForm({
  tokenHash,
  type,
}: {
  tokenHash: string | null;
  type: string | null;
}) {
  const [state, formAction, pending] = useActionState<
    CompleteAcceptResult,
    FormData
  >(completeAcceptInviteAction, INITIAL);

  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  // Missing / invalid token — show the same self-serve "send me a
  // fresh invite" affordance the expired path uses.
  if (!tokenHash || !type) {
    return (
      <ExpiredInviteBlock message="This invite link is missing its token. Ask for a fresh one below." />
    );
  }

  // Server flagged this token as expired — surface the self-serve
  // form here too. state.ok=true triggers a full-page navigate so
  // the user lands on /dashboard with cookies set.
  if (state && "ok" in state && !state.ok && "expired" in state && state.expired) {
    return <ExpiredInviteBlock message={state.message} />;
  }

  if (state && "ok" in state && state.ok) {
    if (typeof window !== "undefined") {
      // Full-page navigate — the invite session cookies were set
      // during the server action. router.push would reuse stale RSC
      // prefetches and break links until a hard refresh.
      setTimeout(() => {
        window.location.href = "/dashboard";
      }, 900);
    }
    return (
      <p className={formStyles.successMessage} role="status">
        You&rsquo;re in. Taking you to your dashboard…
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
        {pending ? "Setting up…" : "Accept invitation"}
      </button>
    </form>
  );
}

// Shown when the invite link is missing/expired. Lets the invitee
// self-serve a fresh link without pinging their admin. Server
// contract: always ok:true, "if that email is on file..." copy so
// we don't leak which emails exist.
function ExpiredInviteBlock({ message }: { message: string }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!email.trim() || pending) return;
    startTransition(async () => {
      await requestFreshInviteAction(email.trim());
      setSent(true);
    });
  }

  return (
    <div className={formStyles.form}>
      <p role="alert" className={formStyles.errorMessage}>
        {message}
      </p>
      {sent ? (
        <p className={formStyles.successMessage} role="status">
          If that email is on our roster and still pending, a fresh
          invitation is on its way. Check your inbox in a minute.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className={formStyles.form}>
          <div className={formStyles.field}>
            <label htmlFor="fresh-invite-email" className={formStyles.label}>
              Send a fresh invitation to
            </label>
            <input
              id="fresh-invite-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={formStyles.input}
              placeholder="you@company.com"
              disabled={pending}
            />
          </div>
          <button
            type="submit"
            className={formStyles.submit}
            disabled={pending || !email.trim()}
            data-loading={pending ? "true" : undefined}
          >
            {pending ? "Sending…" : "Send me a fresh invitation"}
          </button>
        </form>
      )}
    </div>
  );
}
