"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { retryLeadAnalysisAction } from "@/lib/lead-analysis/actions";
import styles from "../../admin/companies/admin.module.css";

export function RetryButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className={styles.primaryButton}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await retryLeadAnalysisAction(id);
            if (!r.ok) setMessage(r.message ?? "Couldn't start it again.");
            router.refresh();
          })
        }
      >
        {pending ? "Starting..." : "Run Again"}
      </button>
      {message ? <p className={styles.errorMessage}>{message}</p> : null}
    </>
  );
}
