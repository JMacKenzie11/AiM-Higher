"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  linkPriorityAction,
  markKeptAction,
  markMissedAction,
  unmarkKeptAction,
  unmarkMissedAction,
} from "@/lib/commitments/actions";
import { CommitmentResolutionChip } from "@/components/plan/CommitmentResolutionChip";
import { formatShortDate } from "@/lib/dates";
import type { Priority } from "@/lib/types";
import type { CommitmentWithMeta } from "@/lib/commitments/service";
import { PriorityPicker } from "./PriorityPicker";
import styles from "./commitments.module.css";

// A single commitment row.
//   - On-time open + click circle    → Kept
//   - Overdue open + click circle    → inline "What happened?" strip
//                                      → Save closes it (status=missed)
//   - Kept + click circle            → revert to Open
//   - Closed (missed) + click circle → revert to Open
//   - Overdue open shows danger dot + danger due-date + danger ring
//     on the circle. No row-wide background fill.
//   - Priority cell: cobalt link when linked, ghost "Link" when
//     unlinked; both open a searchable picker while status='open'.
//     Once resolved the linkage is frozen (would silently rewrite
//     priority progress history).

export type CommitmentRowProps = {
  commitment: CommitmentWithMeta;
  priorityOptions: Array<Pick<Priority, "id" | "title">>;
  todayIso: string;
  canResolve: boolean;
  canLink: boolean;
};

export function CommitmentRow({
  commitment,
  priorityOptions,
  todayIso,
  canResolve,
  canLink,
}: CommitmentRowProps) {
  const [showReason, setShowReason] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isOpen = commitment.status === "open";
  const isKept = commitment.status === "kept";
  const isClosed = commitment.status === "missed";
  const isOverdue = isOpen && commitment.due_date < todayIso;

  function markKept() {
    setError(null);
    startTransition(async () => {
      const result = await markKeptAction(commitment.id);
      if (!result.ok) setError(result.message);
    });
  }

  function unmarkKept() {
    setError(null);
    startTransition(async () => {
      const result = await unmarkKeptAction(commitment.id);
      if (!result.ok) setError(result.message);
    });
  }

  function unmarkMissed() {
    setError(null);
    startTransition(async () => {
      const result = await unmarkMissedAction(commitment.id);
      if (!result.ok) setError(result.message);
    });
  }

  function submitClose() {
    setError(null);
    startTransition(async () => {
      const result = await markMissedAction(commitment.id, reason);
      if (!result.ok) {
        setError(result.message);
      } else {
        setShowReason(false);
        setReason("");
      }
    });
  }

  function linkTo(next: string | null) {
    setError(null);
    startTransition(async () => {
      const result = await linkPriorityAction(commitment.id, next);
      if (!result.ok) setError(result.message);
    });
  }

  function onCircleClick() {
    if (!canResolve) return;
    if (isKept) {
      unmarkKept();
      return;
    }
    if (isClosed) {
      unmarkMissed();
      return;
    }
    if (!isOpen) return;
    if (isOverdue) {
      setShowReason((prev) => !prev);
      return;
    }
    markKept();
  }

  return (
    <li
      className={
        isOpen ? styles.row : `${styles.row} ${styles.rowResolved}`
      }
    >
      <button
        type="button"
        className={buildCircleClass(isKept, isClosed, isOverdue)}
        onClick={onCircleClick}
        disabled={pending || !canResolve}
        aria-label={
          isKept
            ? "Kept — click to reopen"
            : isClosed
            ? "Closed — click to reopen"
            : isOverdue
            ? "Overdue — close with a reason"
            : "Mark kept"
        }
        aria-pressed={isKept || isClosed}
      >
        {isKept ? (
          <span className={styles.checkmark} aria-hidden>✓</span>
        ) : isClosed ? (
          <span className={styles.checkmark} aria-hidden>✕</span>
        ) : null}
      </button>

      <div>
        <p className={styles.rowDescription}>{commitment.description}</p>
        {commitment.missed_reason ? (
          <p className={styles.reasonNote}>Reason: {commitment.missed_reason}</p>
        ) : null}
        {error ? (
          <p role="alert" className={styles.reasonNote} style={{ color: "var(--aims-danger)" }}>
            {error}
          </p>
        ) : null}

        {showReason && isOverdue ? (
          <div className={styles.resolveStrip}>
            <label
              htmlFor={`reason-${commitment.id}`}
              className={styles.stripLabel}
            >
              What happened?
            </label>
            <textarea
              id={`reason-${commitment.id}`}
              className={styles.stripTextarea}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              disabled={pending}
              placeholder="A short note — this is the opportunity to improve."
              autoFocus
            />
            <div className={styles.stripSubmitRow}>
              <button
                type="button"
                className={styles.ghostButton}
                onClick={() => {
                  setShowReason(false);
                  setReason("");
                }}
                disabled={pending}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={submitClose}
                disabled={pending || !reason.trim()}
              >
                {pending ? "Saving…" : "Close it"}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <span className={styles.rowOwner}>
        {commitment.owner?.full_name ?? "—"}
      </span>

      <PriorityCell
        commitment={commitment}
        priorityOptions={priorityOptions}
        canLink={canLink}
        onSelect={linkTo}
        disabled={pending}
      />

      <span
        className={
          isOverdue ? `${styles.rowDue} ${styles.rowDueOverdue}` : styles.rowDue
        }
      >
        {isOverdue ? <span className={styles.rowDueDot} aria-hidden /> : null}
        {formatShortDate(commitment.due_date)}
      </span>

      <CommitmentResolutionChip commitment={commitment} />
    </li>
  );
}

function buildCircleClass(
  isKept: boolean,
  isClosed: boolean,
  isOverdue: boolean
): string {
  const parts = [styles.resolveCircle];
  if (isKept) parts.push(styles.resolveCircleChecked);
  if (isClosed) parts.push(styles.resolveCircleClosed);
  if (isOverdue) parts.push(styles.resolveCircleOverdue);
  return parts.join(" ");
}

function PriorityCell({
  commitment,
  priorityOptions,
  canLink,
  onSelect,
  disabled,
}: {
  commitment: CommitmentWithMeta;
  priorityOptions: Array<Pick<Priority, "id" | "title">>;
  canLink: boolean;
  onSelect: (next: string | null) => void;
  disabled: boolean;
}) {
  const [picking, setPicking] = useState(false);

  if (commitment.status !== "open") {
    return commitment.priority ? (
      <Link
        href={`/plan/priority/${commitment.priority.id}`}
        className={styles.rowPriorityLink}
      >
        {commitment.priority.title}
      </Link>
    ) : (
      <span className={styles.rowPriorityMuted}>Operational</span>
    );
  }

  if (picking && canLink) {
    return (
      <PriorityPicker
        priorityOptions={priorityOptions}
        currentPriorityId={commitment.priority_id}
        onSelect={(next) => {
          setPicking(false);
          onSelect(next);
        }}
        disabled={disabled}
      />
    );
  }

  if (commitment.priority) {
    return canLink ? (
      <button
        type="button"
        className={styles.rowPriorityGhost}
        onClick={() => setPicking(true)}
        disabled={disabled}
        aria-label="Change priority link"
      >
        {commitment.priority.title}
      </button>
    ) : (
      <Link
        href={`/plan/priority/${commitment.priority.id}`}
        className={styles.rowPriorityLink}
      >
        {commitment.priority.title}
      </Link>
    );
  }

  return canLink ? (
    <button
      type="button"
      className={styles.rowPriorityGhost}
      onClick={() => setPicking(true)}
      disabled={disabled}
    >
      Link
    </button>
  ) : (
    <span className={styles.rowPriorityMuted}>Operational</span>
  );
}
