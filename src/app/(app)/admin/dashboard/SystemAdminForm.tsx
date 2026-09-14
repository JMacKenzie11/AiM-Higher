"use client";

import { useActionState } from "react";

import {
  createSystemAdminAction,
  createPortfolioAdminAction,
  type UserActionResult,
} from "@/lib/auth/users";
import { useStayOpenForm } from "@/lib/hooks/use-stay-open-form";
import { ConfirmationChip } from "@/components/ui/ConfirmationChip";
import styles from "@/app/(app)/admin/companies/admin.module.css";

// Add a company-less platform user: a system admin, or a portfolio
// admin.
//
// Same shape as the company roster's InviteForm, and deliberately so:
// the person receives the ordinary invitation and sets their own
// password. What differs is that there is no company to pick and no
// role to choose in the form — the role is fixed by which form this
// is, because both of these roles belong to no company, and that is
// the whole meaning of each.
//
// ONE COMPONENT, TWO ROLES. The forms are identical apart from their
// labels, and a copy would be the thing that keeps the invite-failure
// warning on one and loses it on the other.
//
// Only a system_admin can reach either action. That is the point of
// the portfolio one: it is the door a portfolio_admin must not be
// able to open, so it is behind the role they do not have.

const INITIAL: UserActionResult = { ok: false, message: "" };

export function SystemAdminForm({
  variant = "system_admin",
}: {
  variant?: "system_admin" | "portfolio_admin";
}) {
  const isPortfolio = variant === "portfolio_admin";
  const copy = isPortfolio
    ? {
        idPrefix: "portfolioadmin",
        testId: "portfolio-admin-form",
        buttonTestId: "add-portfolio-admin",
        button: "Add portfolio admin",
        pending: "Adding…",
        confirmation: "Portfolio admin added",
      }
    : {
        idPrefix: "sysadmin",
        testId: "system-admin-form",
        buttonTestId: "add-system-admin",
        button: "Add system admin",
        pending: "Adding…",
        confirmation: "System admin added",
      };

  const [state, formAction, pending] = useActionState<
    UserActionResult,
    FormData
  >(isPortfolio ? createPortfolioAdminAction : createSystemAdminAction, INITIAL);

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
    <form
      action={formAction}
      className={styles.form}
      ref={formRef}
      data-testid={copy.testId}
    >
      <div className={styles.field}>
        <label htmlFor={`${copy.idPrefix}-name`} className={styles.label}>
          Full name
        </label>
        <input
          id={`${copy.idPrefix}-name`}
          name="full_name"
          required
          className={styles.input}
          disabled={pending}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor={`${copy.idPrefix}-email`} className={styles.label}>
          Email
        </label>
        <input
          id={`${copy.idPrefix}-email`}
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
          {warningMessage} Use Send invite on their row above to try again.
        </p>
      ) : null}

      <div className={styles.submitRow}>
        <button
          type="submit"
          className={styles.primaryButton}
          disabled={pending}
          data-testid={copy.buttonTestId}
        >
          {pending ? copy.pending : copy.button}
        </button>
        <ConfirmationChip visible={confirmationVisible} label={copy.confirmation} />
      </div>
    </form>
  );
}
