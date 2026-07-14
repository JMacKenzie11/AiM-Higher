"use client";

import { useState, useTransition } from "react";
import { scopeIntoCompanyAction } from "@/lib/admin/scope-actions";
import { setCompanyStatusAction } from "@/lib/companies/actions";
import styles from "./admin.module.css";

// Per-row Open + Archive/Restore actions for the polished
// /admin/companies table (Section 8.9).

export function CompanyRowActions({
  companyId,
  status,
}: {
  companyId: string;
  status: "active" | "archived";
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function open() {
    startTransition(async () => {
      await scopeIntoCompanyAction(companyId);
    });
  }

  function archive() {
    const nextStatus = status === "active" ? "archived" : "active";
    const confirmText =
      nextStatus === "archived"
        ? "Archive this company? Members won't be able to sign in."
        : "Reactivate this company?";
    if (!confirm(confirmText)) return;
    setError(null);
    startTransition(async () => {
      const result = await setCompanyStatusAction(companyId, nextStatus);
      if (!result.ok) setError(result.message);
    });
  }

  return (
    <div className={styles.rowActions}>
      <button
        type="button"
        className={styles.primaryButtonSm}
        onClick={open}
        disabled={pending || status === "archived"}
      >
        {pending ? "…" : "Open"}
      </button>
      <button
        type="button"
        className={
          status === "active" ? styles.dangerGhost : styles.ghostButton
        }
        onClick={archive}
        disabled={pending}
      >
        {status === "active" ? "Archive" : "Reactivate"}
      </button>
      {error ? (
        <span role="alert" className={styles.inlineError}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
