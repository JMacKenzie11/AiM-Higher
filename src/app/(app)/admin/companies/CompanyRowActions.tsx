"use client";

import { useState, useTransition } from "react";
import { setCompanyStatusAction } from "@/lib/companies/actions";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
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
  const [confirming, setConfirming] = useState(false);
  const nextStatus = status === "active" ? "archived" : "active";

  function run() {
    setConfirming(false);
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
        onClick={() => setConfirming(true)}
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
    </>
  );
}
