"use client";

import { useState, useTransition } from "react";
import {
  closeQuarterAction,
  reopenQuarterAction,
} from "@/lib/quarters/actions";
import type { QuarterWithCounts } from "@/lib/quarters/service";
import styles from "./quarters.module.css";

export function QuartersTable({
  quarters,
  canWrite,
}: {
  quarters: QuarterWithCounts[];
  canWrite: boolean;
}) {
  if (quarters.length === 0) {
    return (
      <p className={styles.empty}>
        No quarters yet. Open your first one above to start tracking priorities.
      </p>
    );
  }

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>Quarter</th>
          <th>Dates</th>
          <th className={styles.numHead}>Priorities</th>
          <th>Status</th>
          {canWrite ? <th className={styles.numHead}>Actions</th> : null}
        </tr>
      </thead>
      <tbody>
        {quarters.map((quarter) => (
          <QuarterRow
            key={quarter.id}
            quarter={quarter}
            canWrite={canWrite}
          />
        ))}
      </tbody>
    </table>
  );
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function QuarterRow({
  quarter,
  canWrite,
}: {
  quarter: QuarterWithCounts;
  canWrite: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const isOpen = quarter.status === "open";

  function handleClose() {
    setConfirming(false);
    startTransition(async () => {
      const result = await closeQuarterAction(quarter.id);
      setMessage(result.ok ? null : result.message);
    });
  }

  function handleReopen() {
    startTransition(async () => {
      const result = await reopenQuarterAction(quarter.id);
      setMessage(result.ok ? null : result.message);
    });
  }

  return (
    <>
      <tr>
        <td>
          <span className={styles.quarterLabel}>{quarter.label}</span>
        </td>
        <td className={styles.dateCell}>
          {formatDate(quarter.start_date)} → {formatDate(quarter.end_date)}
        </td>
        <td className={`${styles.numCell} aims-tabular`}>
          {quarter.priority_count}
        </td>
        <td>
          <span
            className={
              isOpen ? styles.chipOpen : styles.chipClosed
            }
          >
            {quarter.status}
          </span>
        </td>
        {canWrite ? (
          <td>
            <div className={styles.actionsCell}>
              {isOpen ? (
                <button
                  type="button"
                  className={styles.dangerButton}
                  onClick={() => setConfirming(true)}
                  disabled={pending}
                >
                  Close
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.ghostButton}
                  onClick={handleReopen}
                  disabled={pending}
                >
                  {pending ? "Reopening…" : "Reopen"}
                </button>
              )}
            </div>
            {message ? (
              <p className={styles.rowMessage} role="status">
                {message}
              </p>
            ) : null}
          </td>
        ) : null}
      </tr>
      {confirming ? (
        <tr>
          <td colSpan={canWrite ? 5 : 4} className={styles.confirmCell}>
            <div className={styles.confirmBox}>
              <p className={styles.confirmText}>
                Closing <strong>{quarter.label}</strong> freezes it. Its
                priorities and commitments stay visible in history, but it
                won&rsquo;t appear in the current quarter picker.
              </p>
              <div className={styles.confirmActions}>
                <button
                  type="button"
                  className={styles.ghostButton}
                  onClick={() => setConfirming(false)}
                  disabled={pending}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={styles.dangerButton}
                  onClick={handleClose}
                  disabled={pending}
                >
                  {pending ? "Closing…" : "Yes, close it"}
                </button>
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
