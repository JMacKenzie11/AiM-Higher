"use client";

import { useState, useTransition } from "react";
import { bulkResetPlanAction } from "@/lib/plan/actions";
import { CompleteConfirmDialog } from "@/components/plan/CompleteConfirmDialog";
import styles from "./plan.module.css";

// "Start a new planning cycle" — archives every active SFA, goal, and
// priority for the company. Open commitments are unlinked from those
// priorities (they surface as Operational); resolved commitments keep
// their historical link so past-quarter progress stays intact.
// Nothing is ever deleted — reads filter archived rows out of active
// surfaces and everything remains on the DB.

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
        title="Start a new planning cycle?"
        destructive
        body={
          <>
            <p>
              These active items move to the archive so you can build the
              next cycle from a clean canvas:
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
              Nothing is deleted — every record stays on file. Open
              commitments that were linked to these priorities become
              Operational (unlinked); resolved commitments keep their
              historical link so past-quarter progress stays intact.
            </p>
            {error ? (
              <p role="alert" style={{ margin: 0, color: "var(--aims-danger)" }}>
                {error}
              </p>
            ) : null}
          </>
        }
        confirmLabel="Archive and start fresh"
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
