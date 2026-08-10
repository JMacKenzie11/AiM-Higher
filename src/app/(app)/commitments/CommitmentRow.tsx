"use client";

import Link from "next/link";
import { useState, useTransition, useMemo, useEffect, useRef } from "react";
import {
  deleteCommitmentAction,
  linkPriorityAction,
  markInProgressAction,
  markKeptAction,
  markMissedAction,
  reassignCommitmentAction,
  rescheduleCommitmentAction,
  setCommitmentClarityAction,
  unmarkInProgressAction,
  unmarkKeptAction,
  unmarkMissedAction,
  updateCommitmentDescriptionAction,
} from "@/lib/commitments/actions";
import { CommitmentResolutionChip } from "@/components/plan/CommitmentResolutionChip";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { formatShortDate } from "@/lib/dates";
import type { Priority, Profile } from "@/lib/types";
import type { CommitmentWithMeta } from "@/lib/commitments/service";
import { PriorityPicker } from "./PriorityPicker";
import { OwnerPicker } from "./OwnerPicker";
import { PersonQuickViewDrawer } from "./PersonQuickViewDrawer";
import { ClarityChip, ClarityEditor, clarityState } from "./ClarityStrip";
import styles from "./commitments.module.css";

// A single commitment row.
//
// The circle at the left is now a *menu trigger*, not an action.
// Click it (any state, any due date) → a small menu opens with the
// available actions. Menu contents vary by state:
//   - Open + on-time  → Mark kept · Reschedule
//   - Open + overdue  → Mark kept · Mark missed · Reschedule
//   - Kept or Missed  → Reopen
// Mark missed is deliberately hidden until the commitment is
// overdue — a commitment can't be missed before its due date, so
// showing that option on a future-dated open row was nonsensical.
// Rationale: the previous "click = kept for on-time, click = missed
// strip for overdue, click = revert for kept/missed" design was
// state-dependent and caused misclick-in-front-of-client mistakes
// (the UX review's Blocker finding). A menu is one extra click on
// the fast path and buys total safety on every path.
//
// After a resolve, a "Marked kept · Undo" chip persists for 30
// seconds — long enough to survive a sentence in a facilitated
// meeting. The chip is aria-live so screen readers announce it.
//
// Priority cell: cobalt link when linked, ghost "Link" when
// unlinked; both open a searchable picker while status='open'.
// Once resolved the linkage is frozen (would silently rewrite
// priority progress history).

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
  const [showClarity, setShowClarity] = useState(false);
  const [showQuickView, setShowQuickView] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState(
    commitment.description
  );
  // "Just changed" chip — shows for a few seconds after resolving so
  // the coach knows the action landed AND can undo without hunting.
  // The prior UX had no such affordance, which is exactly how the
  // reported real-world misclick went silent.
  const [justResolved, setJustResolved] = useState<
    null | "kept" | "missed" | "in_progress"
  >(null);
  useEffect(() => {
    if (!justResolved) return;
    // 30 seconds — long enough to survive a sentence or two in a
    // facilitated meeting. The prior 6s window was routinely lost
    // when someone started talking, per the UX review.
    const t = setTimeout(() => setJustResolved(null), 30000);
    return () => clearTimeout(t);
  }, [justResolved]);

  const isOpen = commitment.status === "open";
  const isInProgress = commitment.status === "in_progress";
  const isActive = isOpen || isInProgress;
  const isKept = commitment.status === "kept";
  const isClosed = commitment.status === "missed";
  const isOverdue = isActive && commitment.due_date < todayIso;

  // Menu-driven resolve: the circle opens a small popover with the
  // available actions (Mark kept · Mark missed · Reschedule · Reopen).
  // Clicking outside or pressing Escape dismisses without action.
  const [showActionMenu, setShowActionMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!showActionMenu) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setShowActionMenu(false);
    }
    function onClick(e: MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node)
      ) {
        setShowActionMenu(false);
      }
    }
    window.addEventListener("keydown", onKey);
    // Defer the outside-click listener a tick so the click that
    // opened the menu doesn't immediately close it.
    const t = setTimeout(
      () => document.addEventListener("mousedown", onClick),
      0
    );
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(t);
      document.removeEventListener("mousedown", onClick);
    };
  }, [showActionMenu]);

  function markKept() {
    setError(null);
    startTransition(async () => {
      const result = await markKeptAction(commitment.id);
      if (!result.ok) setError(result.message);
      else setJustResolved("kept");
    });
  }

  function unmarkKept() {
    setError(null);
    startTransition(async () => {
      const result = await unmarkKeptAction(commitment.id);
      if (!result.ok) setError(result.message);
      else setJustResolved(null);
    });
  }

  function unmarkMissed() {
    setError(null);
    startTransition(async () => {
      const result = await unmarkMissedAction(commitment.id);
      if (!result.ok) setError(result.message);
      else setJustResolved(null);
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
        setJustResolved("missed");
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

  // Description edit follows the same admin-or-owner rule but has no
  // status restriction — fixing a typo on a resolved commitment is
  // useful and doesn't rewrite historical facts (status, dates).
  const canEditDescription =
    isAdmin || commitment.owner_id === currentUserId;

  function runDelete() {
    setConfirmDelete(false);
    setError(null);
    startTransition(async () => {
      const result = await deleteCommitmentAction(commitment.id);
      if (!result.ok) setError(result.message);
    });
  }

  // Blur-to-save: matches the owner/priority/due-date cells. Empty
  // draft reverts (a blank description would break the row); an
  // unchanged draft just exits edit mode without hitting the server.
  function commitDescription() {
    if (pending) return;
    const next = descriptionDraft.trim();
    if (!next) {
      cancelDescriptionEdit();
      return;
    }
    if (next === commitment.description) {
      setEditingDescription(false);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await updateCommitmentDescriptionAction(
        commitment.id,
        next
      );
      if (!result.ok) {
        setError(result.message);
      } else {
        setEditingDescription(false);
      }
    });
  }

  function cancelDescriptionEdit() {
    setDescriptionDraft(commitment.description);
    setEditingDescription(false);
  }

  function onCircleClick() {
    if (!canResolve) return;
    // Every state opens the same menu now. Circle is a *trigger*,
    // not an action — see the comment atop this file. The menu
    // then handles Kept / Missed / Reschedule / Reopen with the
    // existing action helpers.
    setShowActionMenu((prev) => !prev);
  }

  function markInProgress() {
    setError(null);
    startTransition(async () => {
      const result = await markInProgressAction(commitment.id);
      if (!result.ok) setError(result.message);
      else setJustResolved("in_progress");
    });
  }

  function unmarkInProgress() {
    setError(null);
    startTransition(async () => {
      const result = await unmarkInProgressAction(commitment.id);
      if (!result.ok) setError(result.message);
      else setJustResolved(null);
    });
  }

  function menuChoose(
    action: "kept" | "missed" | "in_progress" | "reschedule" | "reopen"
  ) {
    setShowActionMenu(false);
    setError(null);
    if (action === "kept") {
      markKept();
    } else if (action === "missed") {
      // Missed requires a reason — reveal the existing strip.
      setShowReason(true);
    } else if (action === "in_progress") {
      markInProgress();
    } else if (action === "reschedule") {
      setRescheduleDate(commitment.due_date);
      setShowReschedule(true);
    } else if (action === "reopen") {
      if (isKept) unmarkKept();
      else if (isClosed) unmarkMissed();
      else if (isInProgress) unmarkInProgress();
    }
  }

  return (
    <li
      className={
        // Active rows (open + in_progress) stay in the main row
        // style; only resolved rows (kept/missed) get the muted
        // resolved treatment.
        isActive ? styles.row : `${styles.row} ${styles.rowResolved}`
      }
    >
      <button
        type="button"
        className={buildCircleClass(isKept, isClosed, isOverdue, isInProgress)}
        onClick={onCircleClick}
        disabled={pending || !canResolve}
        data-state={
          isKept
            ? "kept"
            : isClosed
            ? "missed"
            : isInProgress
            ? "in_progress"
            : "open"
        }
        aria-haspopup="menu"
        aria-expanded={showActionMenu}
        title={
          isKept
            ? "Kept — open actions"
            : isClosed
            ? "Missed — open actions"
            : isInProgress
            ? "In progress — open actions"
            : isOverdue
            ? "Overdue — open actions"
            : "Open actions"
        }
        aria-label={
          isKept
            ? "Kept — open actions"
            : isClosed
            ? "Missed — open actions"
            : isInProgress
            ? "In progress — open actions"
            : isOverdue
            ? "Overdue — open actions"
            : "Open actions"
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
          {isClosed ? "✕" : isInProgress ? "◐" : "✓"}
        </span>
      </button>

      {showActionMenu ? (
        <div
          ref={menuRef}
          className={styles.resolveMenu}
          role="menu"
          aria-label="Commitment actions"
        >
          {isActive ? (
            <>
              <button
                type="button"
                className={styles.resolveMenuItemKept}
                role="menuitem"
                onClick={() => menuChoose("kept")}
              >
                <span aria-hidden>✓</span> Mark kept
              </button>
              {isOverdue ? (
                <button
                  type="button"
                  className={styles.resolveMenuItemMissed}
                  role="menuitem"
                  onClick={() => menuChoose("missed")}
                >
                  <span aria-hidden>✕</span> Mark missed
                </button>
              ) : null}
              {isOpen ? (
                <button
                  type="button"
                  className={styles.resolveMenuItem}
                  role="menuitem"
                  onClick={() => menuChoose("in_progress")}
                >
                  <span aria-hidden>◐</span> Mark in progress
                </button>
              ) : null}
              <button
                type="button"
                className={styles.resolveMenuItem}
                role="menuitem"
                onClick={() => menuChoose("reschedule")}
              >
                <span aria-hidden>→</span> Reschedule
              </button>
              {isInProgress ? (
                <button
                  type="button"
                  className={styles.resolveMenuItem}
                  role="menuitem"
                  onClick={() => menuChoose("reopen")}
                >
                  <span aria-hidden>↺</span> Reopen (not started)
                </button>
              ) : null}
            </>
          ) : (
            <button
              type="button"
              className={styles.resolveMenuItem}
              role="menuitem"
              onClick={() => menuChoose("reopen")}
            >
              <span aria-hidden>↺</span> Reopen
            </button>
          )}
        </div>
      ) : null}

      {canDelete ? (
        <button
          type="button"
          className={styles.deleteRowButton}
          onClick={() => setConfirmDelete(true)}
          disabled={pending}
          aria-label="Delete this commitment"
          title="Delete this commitment"
        >
          <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden>
            <path
              d="M4 5 h8 v8 a1 1 0 0 1 -1 1 h-6 a1 1 0 0 1 -1 -1 z M6.5 5 V3.5 a1 1 0 0 1 1 -1 h1 a1 1 0 0 1 1 1 V5 M3 5 h10"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      ) : (
        <span aria-hidden />
      )}

      <div style={{ display: "flex", justifyContent: "center" }}>
        <ClarityChip
          state={clarityState(commitment)}
          onClick={
            canResolve ? () => setShowClarity((prev) => !prev) : undefined
          }
        />
      </div>

      <div>
        {editingDescription ? (
          <textarea
            className={styles.descriptionInput}
            value={descriptionDraft}
            onChange={(e) => setDescriptionDraft(e.target.value)}
            rows={2}
            autoFocus
            disabled={pending}
            onBlur={commitDescription}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                cancelDescriptionEdit();
              }
            }}
          />
        ) : (
          <p className={styles.rowDescription}>
            {canEditDescription ? (
              <button
                type="button"
                className={styles.descriptionEditable}
                onClick={() => setEditingDescription(true)}
                title="Click to edit"
              >
                {commitment.description}
              </button>
            ) : (
              commitment.description
            )}
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
        )}
        {commitment.missed_reason ? (
          <p className={styles.reasonNote}>Reason: {commitment.missed_reason}</p>
        ) : null}
        {justResolved ? (
          <span
            className={
              justResolved === "kept"
                ? styles.justResolvedKept
                : justResolved === "missed"
                ? styles.justResolvedMissed
                : styles.justResolvedInProgress
            }
            role="status"
            aria-live="polite"
          >
            {justResolved === "kept"
              ? "Marked kept"
              : justResolved === "missed"
              ? "Marked missed"
              : "Marked in progress"}
            <button
              type="button"
              className={styles.undoLink}
              onClick={
                justResolved === "kept"
                  ? unmarkKept
                  : justResolved === "missed"
                  ? unmarkMissed
                  : unmarkInProgress
              }
              disabled={pending}
            >
              Undo
            </button>
          </span>
        ) : null}
        {error ? (
          <p role="alert" className={styles.reasonNote} style={{ color: "var(--aims-danger)" }}>
            {error}
          </p>
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
        onOpenQuickView={() => setShowQuickView(true)}
        reassignTo={reassignTo}
        pending={pending}
      />

      {commitment.owner_id ? (
        <PersonQuickViewDrawer
          open={showQuickView}
          ownerId={commitment.owner_id}
          ownerName={commitment.owner?.full_name ?? "This person"}
          roster={roster}
          canReassign={canReassign}
          canCoach={isAdmin}
          onReassign={reassignTo}
          onClose={() => setShowQuickView(false)}
        />
      ) : null}

      <PriorityCell
        commitment={commitment}
        priorityOptions={priorityOptions}
        canLink={canLink}
        onSelect={linkTo}
        disabled={pending}
      />

      {(() => {
        // clarity_timeline === false means the analyzer defaulted the
        // date because no deadline was agreed in the meeting (or a
        // reviewer explicitly marked it that way). Surface it visually
        // so the placeholder date doesn't read as a real commitment.
        const dueAssigned = commitment.clarity_timeline === false;
        const assignedTitle = dueAssigned
          ? "No deadline was agreed in the meeting — this date is a placeholder. Reschedule to lock in a real one."
          : undefined;

        if (isActive && canResolve) {
          const classes = [styles.rowDueButton];
          if (isOverdue) classes.push(styles.rowDueOverdue);
          if (dueAssigned) classes.push(styles.rowDueAssigned);
          return (
            <button
              type="button"
              className={classes.join(" ")}
              onClick={() => {
                setRescheduleDate(commitment.due_date);
                setShowReschedule((prev) => !prev);
              }}
              disabled={pending}
              aria-label={assignedTitle ?? "Reschedule with a reason"}
              title={assignedTitle}
            >
              {isOverdue ? (
                <span className={styles.rowDueDot} aria-hidden />
              ) : dueAssigned ? (
                <span className={styles.rowDueAssignedDot} aria-hidden />
              ) : null}
              {formatShortDate(commitment.due_date)}
            </button>
          );
        }

        const classes = [styles.rowDue];
        if (isOverdue) classes.push(styles.rowDueOverdue);
        if (dueAssigned) classes.push(styles.rowDueAssigned);
        return (
          <span className={classes.join(" ")} title={assignedTitle}>
            {isOverdue ? (
              <span className={styles.rowDueDot} aria-hidden />
            ) : dueAssigned ? (
              <span className={styles.rowDueAssignedDot} aria-hidden />
            ) : null}
            {formatShortDate(commitment.due_date)}
          </span>
        );
      })()}

      <CommitmentResolutionChip commitment={commitment} />

      {/* Full-width editor strips — direct grid children so
          grid-column: 1 / -1 spans the whole row. Previously nested
          inside the description cell, which cramped them to one
          column while the row furniture stranded off to the right. */}
      {showReason && isOverdue ? (
        <div className={styles.resolveStrip}>
          <label
            htmlFor={`reason-${commitment.id}`}
            className={styles.stripLabel}
          >
            What did you learn?
          </label>
          <textarea
            id={`reason-${commitment.id}`}
            className={styles.stripTextarea}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            disabled={pending}
            placeholder="What's a lesson that we can carry forward?"
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

      {showReschedule && isActive ? (
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

      {showClarity && canResolve ? (
        <ClarityEditor
          commitment={commitment}
          onCancel={() => setShowClarity(false)}
          onSaved={() => setShowClarity(false)}
          onError={setError}
        />
      ) : null}

      {canDelete ? (
        <ConfirmDialog
          open={confirmDelete}
          title="Delete this commitment?"
          message="This can't be undone. Any linkage to an action will be lost too."
          confirmLabel="Delete"
          tone="danger"
          onConfirm={runDelete}
          onCancel={() => setConfirmDelete(false)}
          pending={pending}
        />
      ) : null}
    </li>
  );
}

function buildCircleClass(
  isKept: boolean,
  isClosed: boolean,
  isOverdue: boolean,
  isInProgress: boolean
): string {
  const parts = [styles.resolveCircle];
  if (isKept) parts.push(styles.resolveCircleChecked);
  if (isClosed) parts.push(styles.resolveCircleClosed);
  if (isInProgress) parts.push(styles.resolveCircleInProgress);
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
        aria-label="Change action link"
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
//   - Admin or existing owner: click owner name → quick-view drawer
//     (drawer contains the reassign picker so ownership isn't
//     changed by an accidental click, which was the old behaviour).
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
  onOpenQuickView,
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
  onOpenQuickView: () => void;
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
        onClick={onOpenQuickView}
        disabled={pending}
        aria-label={`Open quick view for ${commitment.owner?.full_name ?? "owner"}`}
      >
        {commitment.owner?.full_name ?? "—"}
      </button>
    );
  }

  // Non-reassign viewers still get the drawer — they can't change
  // owner but they can see who this is and jump to the scorecard.
  return (
    <button
      type="button"
      className={styles.rowOwnerButton}
      onClick={onOpenQuickView}
      disabled={pending}
      aria-label={`Open quick view for ${commitment.owner?.full_name ?? "owner"}`}
    >
      {commitment.owner?.full_name ?? "—"}
    </button>
  );
}
