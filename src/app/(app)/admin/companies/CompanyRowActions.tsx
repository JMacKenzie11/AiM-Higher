"use client";

import { useState, useTransition } from "react";
import { setCompanyStatusAction } from "@/lib/companies/actions";
import styles from "./admin.module.css";

// Archive / Reactivate for a company row. The "open this company" flow
// moved onto the company name itself (see CompanyNameLink), so this
// component is now archive-only.

export function CompanyRowActions({
  companyId,
  status,
}: {
  companyId: string;
  status: "active" | "archived";
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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
    <>
      <button
        type="button"
        className={
          status === "active" ? styles.dangerGhost : styles.ghostButton
        }
        onClick={archive}
        disabled={pending}
      >
        {pending
          ? "…"
          : status === "active"
            ? "Archive"
            : "Reactivate"}
      </button>
      {error ? (
        <span role="alert" className={styles.inlineError}>
          {error}
        </span>
      ) : null}
    </>
  );
}
