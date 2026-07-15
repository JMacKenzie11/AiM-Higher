"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  deleteCommitmentAction,
  markKeptAction,
} from "@/lib/commitments/actions";
import { CommitmentResolutionChip } from "@/components/plan/CommitmentResolutionChip";
import type { CommitmentWithMeta } from "@/lib/commitments/weekly-review";
import { formatShortDate } from "@/lib/dates";
import styles from "./weekly-review.module.css";

// This-week row. Kept is available for early completions; Missed and
// Carry stay on Last Week where the week-end decision belongs. Delete
// is still there for "changed my mind, this shouldn't be a commitment"
// and goes through an inline confirm block.

type Mode = "idle" | "confirmDelete";

export function ThisWeekRow({
  commitment,
  canAct,
}: {
  commitment: CommitmentWithMeta;
  canAct: boolean;
}) {
  const [mode, setMode] = useState<Mode>("idle");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function markKept() {
    setError(null);
    startTransition(async () => {
      const result = await markKeptAction(commitment.id);
      if (!result.ok) setError(result.message);
    });
  }

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
        mode === "idle" && canAct ? (
          <div className={styles.actionGroup}>
            <button
              type="button"
              className={styles.successOutlineButton}
              onClick={markKept}
              disabled={pending}
              aria-label="Mark kept"
            >
              Kept
            </button>
            <button
              type="button"
              className={styles.ghostButton}
              onClick={() => setMode("confirmDelete")}
              disabled={pending}
            >
              Delete
            </button>
          </div>
        ) : null
      ) : (
        <CommitmentResolutionChip commitment={commitment} />
      )}
    </li>
  );
}
