"use client";

import Link from "next/link";
import { useState, useTransition, useMemo } from "react";
import {
  deleteCommitmentAction,
  linkPriorityAction,
  markKeptAction,
  markMissedAction,
  reassignCommitmentAction,
  rescheduleCommitmentAction,
  unmarkKeptAction,
  unmarkMissedAction,
} from "@/lib/commitments/actions";
import { CommitmentResolutionChip } from "@/components/plan/CommitmentResolutionChip";
import { formatShortDate } from "@/lib/dates";
import type { Priority, Profile } from "@/lib/types";
import type { CommitmentWithMeta } from "@/lib/commitments/service";
import { PriorityPicker } from "./PriorityPicker";
import { OwnerPicker } from "./OwnerPicker";
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
  roster: Array<Pick<Profile, "id" | "full_name">>;
  todayIso: string;
  canResolve: boolean;
  canLink: boolean;
  // Reassign follows the same admin-or-owner rule as resolve. Kept
  // as its own prop so callers can gate it independently later if the
  // policy diverges.
  canReassign: boolean;
  // The caller's own profile id + whether they're an admin. Together
  // these decide (a) whether a team member can claim an unassigned
  // row for themselves, and (b) whether the "From meeting" chip
  // deep-links to the analysis page.
  currentUserId: string;
  isAdmin: boolean;
};

export function CommitmentRow({
  commitment,
  priorityOptions,
  roster,
  todayIso,
  canResolve,
  canLink,
  canReassign,
  currentUserId,
  isAdmin,
}: CommitmentRowProps) {
  const [showReason, setShowReason] = useState(false);
  const [reason, setReason] = useState("");
  const [showReschedule, setShowReschedule] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState(commitment.due_date);
  const [rescheduleReason, setRescheduleReason] = useState("");
  const [pickingOwner, setPickingOwner] = useState(false);
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

  function reassignTo(newOwnerId: string) {
    setError(null);
    setPickingOwner(false);
    startTransition(async () => {
      const result = await reassignCommitmentAction(commitment.id, newOwnerId);
      if (!result.ok) setError(result.message);
    });
  }

  function submitReschedule() {
    setError(null);
    startTransition(async () => {
      const result = await rescheduleCommitmentAction(
        commitment.id,
        rescheduleDate,
        rescheduleReason
      );
      if (!result.ok) {
        setError(result.message);
      } else {
        setShowReschedule(false);
        setRescheduleReason("");
      }
    });
  }

  // Admins can delete any commitment in their company; owners can
  // delete their own open commitments. Resolved rows stay in history
  // for non-admins (the server enforces both rules).
  const canDelete =
    isAdmin || (commitment.owner_id === currentUserId && isOpen);

  function handleDelete() {
    if (!canDelete) return;
    if (
      !confirm(
        "Delete this commitment? This can't be undone."
      )
    )
      return;
    setError(null);
    startTransition(async () => {
      const result = await deleteCommitmentAction(commitment.id);
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
        <span
          className={styles.checkmark}
          aria-hidden
          style={
            isKept || isClosed
              ? undefined
              : { color: "var(--text-muted)" }
          }
        >
          {isClosed ? "✕" : "✓"}
        </span>
      </button>

      {canDelete ? (
        <button
          type="button"
          className={styles.deleteRowButton}
          onClick={handleDelete}
          disabled={pending}
          aria-label="Delete this commitment"
          title="Delete this commitment"
        >
          <span aria-hidden>×</span>
        </button>
      ) : (
        <span aria-hidden />
      )}

      <div>
        <p className={styles.rowDescription}>
          {commitment.description}
          {commitment.source_meeting_id ? (
            isAdmin ? (
              <Link
                href={`/leadership/meetings/${commitment.source_meeting_id}`}
                className={styles.fromMeetingChip}
                title="From a meeting transcript — click to view analysis"
              >
                From meeting
              </Link>
            ) : (
              <span
                className={styles.fromMeetingChip}
                title="Created from a meeting transcript"
              >
                From meeting
              </span>
            )
          ) : null}
        </p>
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

        {showReschedule && isOpen ? (
          <div className={styles.resolveStrip}>
            <label
              htmlFor={`reschedule-date-${commitment.id}`}
              className={styles.stripLabel}
            >
              Move to
            </label>
            <input
              id={`reschedule-date-${commitment.id}`}
              type="date"
              className={styles.stripInput}
              value={rescheduleDate}
              onChange={(e) => setRescheduleDate(e.target.value)}
              disabled={pending}
            />
            <label
              htmlFor={`reschedule-reason-${commitment.id}`}
              className={styles.stripLabel}
            >
              Reason
            </label>
            <textarea
              id={`reschedule-reason-${commitment.id}`}
              className={styles.stripTextarea}
              value={rescheduleReason}
              onChange={(e) => setRescheduleReason(e.target.value)}
              rows={2}
              disabled={pending}
              placeholder="Enter a reason for moving the due date"
            />
            <div className={styles.stripSubmitRow}>
              <button
                type="button"
                className={styles.ghostButton}
                onClick={() => {
                  setShowReschedule(false);
                  setRescheduleDate(commitment.due_date);
                  setRescheduleReason("");
                }}
                disabled={pending}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={submitReschedule}
                disabled={
                  pending ||
                  !rescheduleReason.trim() ||
                  !rescheduleDate ||
                  rescheduleDate === commitment.due_date
                }
              >
                {pending ? "Saving…" : "Reschedule"}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <OwnerCell
        commitment={commitment}
        roster={roster}
        canReassign={canReassign}
        currentUserId={currentUserId}
        isAdmin={isAdmin}
        pickingOwner={pickingOwner}
        setPickingOwner={setPickingOwner}
        reassignTo={reassignTo}
        pending={pending}
      />

      <PriorityCell
        commitment={commitment}
        priorityOptions={priorityOptions}
        canLink={canLink}
        onSelect={linkTo}
        disabled={pending}
      />

      {isOpen && canResolve ? (
        <button
          type="button"
          className={
            isOverdue
              ? `${styles.rowDueButton} ${styles.rowDueOverdue}`
              : styles.rowDueButton
          }
          onClick={() => {
            setRescheduleDate(commitment.due_date);
            setShowReschedule((prev) => !prev);
          }}
          disabled={pending}
          aria-label="Reschedule with a reason"
        >
          {isOverdue ? <span className={styles.rowDueDot} aria-hidden /> : null}
          {formatShortDate(commitment.due_date)}
        </button>
      ) : (
        <span
          className={
            isOverdue ? `${styles.rowDue} ${styles.rowDueOverdue}` : styles.rowDue
          }
        >
          {isOverdue ? <span className={styles.rowDueDot} aria-hidden /> : null}
          {formatShortDate(commitment.due_date)}
        </span>
      )}

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

// Owner column. Three shapes:
//   - Admin or existing owner: click owner name → full-roster picker.
//   - Team member on an unassigned row: click "Unassigned" chip → one-
//     click self-claim (they can only assign to themselves).
//   - Otherwise: read-only name or muted "Unassigned" chip.
function OwnerCell({
  commitment,
  roster,
  canReassign,
  currentUserId,
  isAdmin,
  pickingOwner,
  setPickingOwner,
  reassignTo,
  pending,
}: {
  commitment: CommitmentWithMeta;
  roster: Array<Pick<Profile, "id" | "full_name">>;
  canReassign: boolean;
  currentUserId: string;
  isAdmin: boolean;
  pickingOwner: boolean;
  setPickingOwner: (b: boolean) => void;
  reassignTo: (id: string) => void;
  pending: boolean;
}) {
  const canClaim =
    commitment.owner_id === null && !isAdmin && !canReassign;
  // Admins + existing owners see the full-roster picker; a team
  // member on an unassigned row gets a self-only picker so the
  // action can't silently target another person.
  const pickerRoster = useMemo(
    () =>
      canReassign
        ? roster
        : roster.filter((p) => p.id === currentUserId),
    [canReassign, roster, currentUserId]
  );

  if (pickingOwner && (canReassign || canClaim)) {
    return (
      <span className={styles.rowOwner}>
        <OwnerPicker
          roster={pickerRoster}
          currentOwnerId={commitment.owner_id}
          onSelect={reassignTo}
          disabled={pending}
        />
      </span>
    );
  }

  if (commitment.owner_id === null) {
    if (canReassign || canClaim) {
      return (
        <button
          type="button"
          className={`${styles.rowOwnerButton} ${styles.rowOwnerUnassigned}`}
          onClick={() => setPickingOwner(true)}
          disabled={pending}
          aria-label={canClaim ? "Claim this commitment" : "Assign owner"}
        >
          Unassigned
        </button>
      );
    }
    return <span className={styles.rowOwnerUnassignedChip}>Unassigned</span>;
  }

  if (canReassign) {
    return (
      <button
        type="button"
        className={styles.rowOwnerButton}
        onClick={() => setPickingOwner(true)}
        disabled={pending}
        aria-label="Reassign owner"
      >
        {commitment.owner?.full_name ?? "—"}
      </button>
    );
  }

  return (
    <span className={styles.rowOwner}>
      {commitment.owner?.full_name ?? "—"}
    </span>
  );
}
