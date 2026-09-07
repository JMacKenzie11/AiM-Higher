"use client";

import { useActionState } from "react";

import {
  createSystemAdminAction,
  type UserActionResult,
} from "@/lib/auth/users";
import { useStayOpenForm } from "@/lib/hooks/use-stay-open-form";
import { ConfirmationChip } from "@/components/ui/ConfirmationChip";
import styles from "@/app/(app)/admin/companies/admin.module.css";

// Add a system admin.
//
// Same shape as the company roster's InviteForm, and deliberately so:
// the person receives the ordinary invitation and sets their own
// password. What differs is that there is no company to pick and no
// role to choose — a system_admin belongs to no company, which is the
// whole meaning of the role.
//
// The invite can be held back the same way it can for a company user,
// so an account can be staged before the person is ready for it.

const INITIAL: UserActionResult = { ok: false, message: "" };

export function SystemAdminForm() {
  const [state, formAction, pending] = useActionState<
    UserActionResult,
    FormData
  >(createSystemAdminAction, INITIAL);

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
      <div className={styles.field}>
        <label htmlFor="sysadmin-name" className={styles.label}>
          Full name
        </label>
        <input
          id="sysadmin-name"
          name="full_name"
          required
          className={styles.input}
          disabled={pending}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="sysadmin-email" className={styles.label}>
          Email
        </label>
        <input
          id="sysadmin-email"
          name="email"
          type="email"
          required
          className={styles.input}
          disabled={pending}
        />
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
          data-testid="add-system-admin"
        >
          {pending ? "Adding…" : "Add system admin"}
        </button>
        <ConfirmationChip visible={confirmationVisible} label="System admin added" />
      </div>
    </form>
  );
}
