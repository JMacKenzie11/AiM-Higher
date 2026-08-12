"use client";

import { useActionState } from "react";
import { createUserAction, type UserActionResult } from "@/lib/auth/users";
import { useStayOpenForm } from "@/lib/hooks/use-stay-open-form";
import { ConfirmationChip } from "@/components/ui/ConfirmationChip";
import styles from "../admin.module.css";

// Add a user to a company. The person can be created without sending
// the invite email — admins can pre-stage the roster, assign work,
// then send the invite when they're ready. Strengths + superpowers
// are set later on the person's profile.

const INITIAL: UserActionResult = { ok: false, message: "" };

export function InviteForm({ companyId }: { companyId: string }) {
  const [state, formAction, pending] = useActionState<
    UserActionResult,
    FormData
  >(createUserAction, INITIAL);

  const errorMessage =
    state && "ok" in state && !state.ok && state.message ? state.message : null;
  const warningMessage =
    state && "ok" in state && state.ok && state.warning ? state.warning : null;
  const { formRef, confirmationVisible } = useStayOpenForm(
    state,
    pending,
    (s) => Boolean(s && "ok" in s && s.ok)
  );

  return (
    <form action={formAction} className={styles.form} ref={formRef}>
      <input type="hidden" name="company_id" value={companyId} />

      <div className={styles.field}>
        <label htmlFor="user-name" className={styles.label}>
          Full name
        </label>
        <input
          id="user-name"
          name="full_name"
          required
          className={styles.input}
          disabled={pending}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="user-email" className={styles.label}>
          Email
        </label>
        <input
          id="user-email"
          name="email"
          type="email"
          required
          className={styles.input}
          disabled={pending}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="user-position" className={styles.label}>
          Position
        </label>
        <input
          id="user-position"
          name="position"
          className={styles.input}
          placeholder="Job title (optional)"
          disabled={pending}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="user-role" className={styles.label}>
          Role
        </label>
        <select
          id="user-role"
          name="role"
          defaultValue="team_member"
          className={styles.select}
          disabled={pending}
        >
          <option value="team_member">Member</option>
          <option value="company_admin">Company Admin</option>
        </select>
      </div>

      <label className={`${styles.checkOption} ${styles.formFull}`}>
        <input type="checkbox" name="send_invite_now" disabled={pending} />
        Send invite email now
      </label>

      {errorMessage ? (
        <p role="alert" className={styles.errorMessage}>
          {errorMessage}
        </p>
      ) : null}

      {warningMessage ? (
        <p role="status" className={styles.warningMessage}>
          {warningMessage} Use the Resend invite button on their row to try
          again.
        </p>
      ) : null}

      <div className={styles.submitRow}>
        <button
          type="submit"
          className={styles.primaryButton}
          disabled={pending}
        >
          {pending ? "Adding…" : "Add user"}
        </button>
        <ConfirmationChip visible={confirmationVisible} label="User added" />
      </div>
    </form>
  );
}
