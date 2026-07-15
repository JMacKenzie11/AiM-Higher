"use client";

import { useState, useTransition } from "react";
import { bulkResetPlanAction } from "@/lib/plan/actions";
import { CompleteConfirmDialog } from "@/components/plan/CompleteConfirmDialog";
import styles from "./plan.module.css";

// "Start new planning session" — archives every active SFA, goal, and
// priority for the company. Commitments are left alone; their links to
// (now-hidden) priorities are preserved as history. Reads filter
// archived rows out of active surfaces.

export type BulkResetButtonProps = {
  companyId: string;
  sfaCount: number;
  goalCount: number;
  priorityCount: number;
};

export function BulkResetButton({
  companyId,
  sfaCount,
  goalCount,
  priorityCount,
}: BulkResetButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const hasAnything = sfaCount + goalCount + priorityCount > 0;

  function run() {
    setError(null);
    startTransition(async () => {
      const result = await bulkResetPlanAction(companyId);
      if (!result.ok) {
        setError(result.message);
      } else {
        setConfirming(false);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        className={styles.resetButton}
        onClick={() => setConfirming(true)}
        disabled={!hasAnything}
        title={
          hasAnything
            ? undefined
            : "Nothing to reset — no active plan items."
        }
      >
        Start new planning session
      </button>

      <CompleteConfirmDialog
        open={confirming}
        title="Start a new planning session?"
        destructive
        body={
          <>
            <p>
              This archives every active item on your plan so you can start
              fresh:
            </p>
            <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
              <li>
                <strong>{sfaCount}</strong>{" "}
                Strategic {sfaCount === 1 ? "Focus Area" : "Focus Areas"}
              </li>
              <li>
                <strong>{goalCount}</strong>{" "}
                Annual {goalCount === 1 ? "Goal" : "Goals"}
              </li>
              <li>
                <strong>{priorityCount}</strong>{" "}
                {priorityCount === 1 ? "Priority" : "Priorities"}
              </li>
            </ul>
            <p style={{ margin: 0, color: "var(--text-muted)" }}>
              Commitments are untouched. Their history stays intact, but the
              old items disappear from active views.
            </p>
            {error ? (
              <p role="alert" style={{ margin: 0, color: "var(--aims-danger)" }}>
                {error}
              </p>
            ) : null}
          </>
        }
        confirmLabel="Archive everything"
        pending={pending}
        onConfirm={run}
        onCancel={() => {
          if (!pending) {
            setConfirming(false);
            setError(null);
          }
        }}
      />
    </>
  );
}
