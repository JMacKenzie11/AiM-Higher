"use client";

import { useActionState } from "react";
import {
  createInvitationAction,
  type InvitationResult,
} from "@/lib/auth/invitations";
import { useStayOpenForm } from "@/lib/hooks/use-stay-open-form";
import { ConfirmationChip } from "@/components/ui/ConfirmationChip";
import styles from "../admin.module.css";

const INITIAL: InvitationResult = { ok: false, message: "" };

export function InviteForm({ companyId }: { companyId: string }) {
  const [state, formAction, pending] = useActionState<
    InvitationResult,
    FormData
  >(createInvitationAction, INITIAL);

  const errorMessage =
    state && "ok" in state && !state.ok && state.message ? state.message : null;
  const { formRef, confirmationVisible } = useStayOpenForm(
    state,
    pending,
    (s) => Boolean(s && "ok" in s && s.ok)
  );

  return (
    <form action={formAction} className={styles.form} ref={formRef}>
      <input type="hidden" name="company_id" value={companyId} />

      <div className={styles.field}>
        <label htmlFor="invite-name" className={styles.label}>
          Full name
        </label>
        <input
          id="invite-name"
          name="full_name"
          required
          className={styles.input}
          disabled={pending}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="invite-email" className={styles.label}>
          Email
        </label>
        <input
          id="invite-email"
          name="email"
          type="email"
          required
          className={styles.input}
          disabled={pending}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="invite-position" className={styles.label}>
          Position
        </label>
        <input
          id="invite-position"
          name="position"
          className={styles.input}
          placeholder="Job title (optional)"
          disabled={pending}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="invite-role" className={styles.label}>
          Role
        </label>
        <select
          id="invite-role"
          name="role"
          defaultValue="team_member"
          className={styles.select}
          disabled={pending}
        >
          <option value="team_member">Team member</option>
          <option value="company_admin">Company admin</option>
        </select>
      </div>

      {errorMessage ? (
        <p role="alert" className={styles.errorMessage}>
          {errorMessage}
        </p>
      ) : null}

      <div className={styles.submitRow}>
        <button
          type="submit"
          className={styles.primaryButton}
          disabled={pending}
        >
          {pending ? "Sending…" : "Send invitation"}
        </button>
        <ConfirmationChip visible={confirmationVisible} label="Invitation sent" />
      </div>
    </form>
  );
}
