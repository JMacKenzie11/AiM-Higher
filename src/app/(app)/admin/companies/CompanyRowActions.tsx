"use client";

import { useState, useTransition } from "react";
import {
  deleteCompanyAction,
  setCompanyStatusAction,
} from "@/lib/companies/actions";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import styles from "./admin.module.css";

// Archive / Reactivate for a company row, plus a Delete affordance
// that only shows once a company is archived (two-step safety so
// active tenants can't be soft-deleted by accident).
//
// Delete is a soft delete — the row stays in the DB with a
// deleted_at timestamp, hidden from every UI via the
// companies_hide_deleted RLS policy (migration 0148). Recoverable
// from SQL only; no user-facing restore.

export function CompanyRowActions({
  companyId,
  status,
}: {
  companyId: string;
  status: "active" | "archived";
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const nextStatus = status === "active" ? "archived" : "active";

  function run() {
    setConfirming(false);
    setError(null);
    startTransition(async () => {
      const result = await setCompanyStatusAction(companyId, nextStatus);
      if (!result.ok) setError(result.message);
    });
  }

  function runDelete() {
    setConfirmingDelete(false);
    setError(null);
    startTransition(async () => {
      const result = await deleteCompanyAction(companyId);
      if (!result.ok) setError(result.message);
    });
  }

  return (
    <>
      <button
        type="button"
        className={
          status === "active" ? styles.dangerGhost : styles.ghostButton
        }
        onClick={() => setConfirming(true)}
        disabled={pending}
        // Reserve a min-width equal to the widest label so the Actions
        // column doesn't jitter left when a row swaps Archive (7 chars)
        // for Reactivate (10). Justify-end on the parent .rowActions
        // was pulling the whole pair leftward on wider labels.
        style={{ minWidth: 88, textAlign: "center" }}
      >
        {pending
          ? "…"
          : status === "active"
            ? "Archive"
            : "Reactivate"}
      </button>
      {status === "archived" ? (
        <button
          type="button"
          className={styles.dangerGhost}
          onClick={() => setConfirmingDelete(true)}
          disabled={pending}
          style={{ minWidth: 88, textAlign: "center" }}
        >
          Delete
        </button>
      ) : null}
      {error ? (
        <span role="alert" className={styles.inlineError}>
          {error}
        </span>
      ) : null}
      <ConfirmDialog
        open={confirming}
        title={
          nextStatus === "archived"
            ? "Archive this company?"
            : "Reactivate this company?"
        }
        message={
          nextStatus === "archived"
            ? "Members won't be able to sign in. All data stays intact and reappears if you reactivate later."
            : "Members can sign in again immediately."
        }
        confirmLabel={nextStatus === "archived" ? "Archive" : "Reactivate"}
        tone={nextStatus === "archived" ? "danger" : "primary"}
        onConfirm={run}
        onCancel={() => setConfirming(false)}
        pending={pending}
      />
      <ConfirmDialog
        open={confirmingDelete}
        title="Delete this company?"
        message="The company disappears from every list — admin, guide HQ, company picker. All underlying data (people, functions, commitments, meetings, transcripts) stays in the database and is recoverable from SQL, but there's no in-app restore."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={runDelete}
        onCancel={() => setConfirmingDelete(false)}
        pending={pending}
      />
    </>
  );
}
