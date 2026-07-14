"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  carryForwardAction,
  markKeptAction,
  markMissedAction,
} from "@/lib/commitments/actions";
import { CommitmentResolutionChip } from "@/components/plan/CommitmentResolutionChip";
import type { CommitmentWithMeta } from "@/lib/commitments/weekly-review";
import { addDays, formatShortDate } from "@/lib/dates";
import styles from "./weekly-review.module.css";

// Last-week row. Open commitments show three pill buttons.
// Missed opens an inline reason field; Carry opens an inline confirm.
// Resolved rows collapse to a single line with the resolution chip.

type Mode = "idle" | "missed" | "carry";

export function LastWeekRow({
  commitment,
  canAct,
}: {
  commitment: CommitmentWithMeta;
  canAct: boolean;
}) {
  const [mode, setMode] = useState<Mode>("idle");
  const [reason, setReason] = useState("");
  const [completedLate, setCompletedLate] = useState<"no" | "yes">("no");
  const [carryText, setCarryText] = useState(commitment.description);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isOpen = commitment.status === "open";

  function markKept() {
    setError(null);
    startTransition(async () => {
      const result = await markKeptAction(commitment.id);
      if (!result.ok) setError(result.message);
    });
  }

  function submitMissed() {
    setError(null);
    startTransition(async () => {
      const result = await markMissedAction(
        commitment.id,
        reason,
        completedLate === "yes"
      );
      if (!result.ok) {
        setError(result.message);
      } else {
        setMode("idle");
        setReason("");
        setCompletedLate("no");
      }
    });
  }

  function submitCarry() {
    setError(null);
    startTransition(async () => {
      const result = await carryForwardAction(commitment.id, carryText);
      if (!result.ok) {
        setError(result.message);
      } else {
        setMode("idle");
      }
    });
  }

  // Resolved (or carried) rows collapse.
  if (!isOpen) {
    return (
      <li className={styles.resolvedRow}>
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
          {commitment.missed_reason ? (
            <p className={styles.reasonNote}>
              Reason: {commitment.missed_reason}
            </p>
          ) : null}
        </div>
        <CommitmentResolutionChip commitment={commitment} />
      </li>
    );
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

        {mode === "missed" ? (
          <div className={styles.inlineBox}>
            <fieldset className={styles.radioGroup}>
              <legend className={styles.label}>
                Was it eventually completed?
              </legend>
              <label className={styles.radioOption}>
                <input
                  type="radio"
                  name={`completed-${commitment.id}`}
                  value="no"
                  checked={completedLate === "no"}
                  onChange={() => setCompletedLate("no")}
                  disabled={pending}
                />
                <span>No — it&rsquo;s still not done</span>
              </label>
              <label className={styles.radioOption}>
                <input
                  type="radio"
                  name={`completed-${commitment.id}`}
                  value="yes"
                  checked={completedLate === "yes"}
                  onChange={() => setCompletedLate("yes")}
                  disabled={pending}
                />
                <span>Yes, but late</span>
              </label>
            </fieldset>

            <label htmlFor={`reason-${commitment.id}`} className={styles.label}>
              What got in the way?
            </label>
            <textarea
              id={`reason-${commitment.id}`}
              className={styles.textarea}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              placeholder="A short note — this feeds pattern-spotting over time."
              disabled={pending}
            />

            <div className={styles.inlineActions}>
              <button
                type="button"
                className={styles.ghostButton}
                onClick={() => {
                  setMode("idle");
                  setReason("");
                  setCompletedLate("no");
                  setError(null);
                }}
                disabled={pending}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.dangerFilledButton}
                onClick={submitMissed}
                disabled={pending || !reason.trim()}
              >
                {pending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        ) : null}

        {mode === "carry" ? (
          <div className={styles.inlineBox}>
            <p className={styles.confirmText}>
              Carry this into week ending{" "}
              <strong>{formatShortDate(addDays(commitment.week_ending, 7))}</strong>.
              This closes the current one and creates a new commitment.
            </p>
            <label
              htmlFor={`carry-${commitment.id}`}
              className={styles.label}
            >
              Description for next week
            </label>
            <textarea
              id={`carry-${commitment.id}`}
              className={styles.textarea}
              value={carryText}
              onChange={(event) => setCarryText(event.target.value)}
              rows={2}
              disabled={pending}
            />
            <div className={styles.inlineActions}>
              <button
                type="button"
                className={styles.ghostButton}
                onClick={() => {
                  setMode("idle");
                  setCarryText(commitment.description);
                  setError(null);
                }}
                disabled={pending}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.navyOutlineButton}
                onClick={submitCarry}
                disabled={pending || !carryText.trim()}
              >
                {pending ? "Carrying…" : "Carry it forward"}
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

      {mode === "idle" ? (
        <div className={styles.actionGroup}>
          <button
            type="button"
            className={styles.successOutlineButton}
            onClick={markKept}
            disabled={!canAct || pending}
            aria-label="Mark kept"
          >
            Kept
          </button>
          <button
            type="button"
            className={styles.dangerOutlineButton}
            onClick={() => setMode("missed")}
            disabled={!canAct || pending}
          >
            Missed
          </button>
          <button
            type="button"
            className={styles.navyOutlineButton}
            onClick={() => setMode("carry")}
            disabled={!canAct || pending}
          >
            Carry forward
          </button>
        </div>
      ) : null}
    </li>
  );
}
