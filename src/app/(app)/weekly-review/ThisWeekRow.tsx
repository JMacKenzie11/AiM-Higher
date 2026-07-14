"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { deleteCommitmentAction } from "@/lib/commitments/actions";
import { CommitmentResolutionChip } from "@/components/plan/CommitmentResolutionChip";
import type { CommitmentWithMeta } from "@/lib/commitments/weekly-review";
import { formatShortDate } from "@/lib/dates";
import styles from "./weekly-review.module.css";

// This-week row. Compact: no Kept/Missed buttons (that's Last Week's
// job when the week ends). The row's own owner (or an admin) can
// delete their open row while the week is still current. Deletion
// goes through an inline confirm block to stay consistent with the
// Missed/Carry patterns above.

type Mode = "idle" | "confirmDelete";

export function ThisWeekRow({
  commitment,
  canDelete,
}: {
  commitment: CommitmentWithMeta;
  canDelete: boolean;
}) {
  const [mode, setMode] = useState<Mode>("idle");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function confirmDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteCommitmentAction(commitment.id);
      if (!result.ok) {
        setError(result.message);
      } else {
        setMode("idle");
      }
    });
  }

  return (
    <li className={styles.openRow}>
      <div className={styles.rowMain}>
        <p className={styles.rowDescription}>{commitment.description}</p>
        <p className={styles.rowMeta}>
          {commitment.priority ? (
            <Link
              href={`/plan/priority/${commitment.priority.id}`}
              className={styles.rowPriorityLink}
            >
              {commitment.priority.title}
            </Link>
          ) : (
            <span>No priority</span>
          )}
          {" · Due "}
          {formatShortDate(commitment.due_date)}
        </p>

        {mode === "confirmDelete" ? (
          <div className={styles.inlineBox}>
            <p className={styles.confirmText}>
              Delete this open commitment? Once it&rsquo;s gone, it&rsquo;s
              gone — it won&rsquo;t appear in history.
            </p>
            <div className={styles.inlineActions}>
              <button
                type="button"
                className={styles.ghostButton}
                onClick={() => {
                  setMode("idle");
                  setError(null);
                }}
                disabled={pending}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.dangerFilledButton}
                onClick={confirmDelete}
                disabled={pending}
              >
                {pending ? "Deleting…" : "Yes, delete it"}
              </button>
            </div>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className={styles.errorMessage}>
            {error}
          </p>
        ) : null}
      </div>

      {commitment.status === "open" ? (
        mode === "idle" && canDelete ? (
          <button
            type="button"
            className={styles.ghostButton}
            onClick={() => setMode("confirmDelete")}
            disabled={pending}
          >
            Delete
          </button>
        ) : null
      ) : (
        <CommitmentResolutionChip commitment={commitment} />
      )}
    </li>
  );
}
