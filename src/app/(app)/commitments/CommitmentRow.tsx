"use client";

import Link from "next/link";
import { useState, useTransition, useMemo, useEffect, useRef } from "react";
import {
  deleteCommitmentAction,
  linkPriorityAction,
  markKeptAction,
  markMissedAction,
  parkCommitmentAction,
  reassignCommitmentAction,
  rescheduleCommitmentAction,
  setCommitmentClarityAction,
  stopRepeatingAction,
  unmarkKeptAction,
  unmarkMissedAction,
  unparkCommitmentAction,
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
// Resolution model (migration 0139):
//   open          — still to do.
//   kept_on_time  — completed on/before the due date. Green ✓.
//   kept_late     — completed after the due date. Green ✓ with a
//                   small clock badge — same "did the work" signal,
//                   never styled as failure.
//   missed        — not done. Red ✕.
//
// The circle at the left is a *menu trigger*. Menu contents depend
// on state and the caller's role:
//   open + on-time      → Mark kept · Reschedule · Park
//   open + overdue      → Mark kept (records late) · Mark missed ·
//                         Reschedule · Park
//   kept_* / missed     → Reopen
// Ongoing (weekly) rows always sit in the open bucket — resolving
// records the occurrence + rolls the due_date forward one week; the
// menu also carries a "Stop repeating" affordance.
//
// Reason prompts:
//   - Owners marking missed: reason required.
//   - Owners marking late-keep: reason optional (ghost Skip button).
//   - Owners rescheduling: reason required.
//   - Admins / guides on any of the above: no reason prompt at all
//     — they typically resolve during the weekly meeting on
//     someone else's behalf.

export type CommitmentRowProps = {
  commitment: CommitmentWithMeta;
  priorityOptions: Array<Pick<Priority, "id" | "title">>;
  roster: Array<Pick<Profile, "id" | "full_name">>;
  todayIso: string;
  canResolve: boolean;
  canLink: boolean;
  canReassign: boolean;
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
  // "late" reason strip is a distinct flow — the owner might still
  // want to log context ("stuck on X for two days") even though the
  // work landed.
  const [showLateReason, setShowLateReason] = useState(false);
  const [lateReason, setLateReason] = useState("");
  const [showReschedule, setShowReschedule] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState(commitment.due_date);
  const [rescheduleReason, setRescheduleReason] = useState("");
  const [showUnpark, setShowUnpark] = useState(false);
  const [unparkDate, setUnparkDate] = useState(todayIso);
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

  const [justResolved, setJustResolved] = useState<
    null | "kept_on_time" | "kept_late" | "missed" | "parked"
  >(null);
  useEffect(() => {
    if (!justResolved) return;
    const t = setTimeout(() => setJustResolved(null), 30000);
    return () => clearTimeout(t);
  }, [justResolved]);

  const isOpen = commitment.status === "open";
  const isParked = commitment.parked_at !== null;
  const isKeptOnTime = commitment.status === "kept_on_time";
  const isKeptLate = commitment.status === "kept_late";
  const isKept = isKeptOnTime || isKeptLate;
  const isMissed = commitment.status === "missed";
  const isOverdue = isOpen && !isParked && commitment.due_date < todayIso;
  const isOngoing = commitment.is_ongoing;

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

  // ---- Server calls ----
  function markKept(reasonInput?: string | null) {
    setError(null);
    startTransition(async () => {
      const result = await markKeptAction(commitment.id, {
        reason: reasonInput ?? null,
      });
      if (!result.ok) {
        setError(result.message);
      } else {
        // Server decides on-time vs late; reflect what we know from
        // the returned row so the undo chip picks the right verb.
        setShowLateReason(false);
        setLateReason("");
        setJustResolved(
          result.commitment.status === "kept_late" ? "kept_late" : "kept_on_time"
        );
      }
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

  function submitMissed() {
    setError(null);
    startTransition(async () => {
      const result = await markMissedAction(
        commitment.id,
        reason.trim() || null
      );
      if (!result.ok) {
        setError(result.message);
      } else {
        setShowReason(false);
        setReason("");
        setJustResolved("missed");
      }
    });
  }

  function submitReschedule() {
    setError(null);
    startTransition(async () => {
      const result = await rescheduleCommitmentAction(
        commitment.id,
        rescheduleDate,
        rescheduleReason.trim() || null
      );
      if (!result.ok) {
        setError(result.message);
      } else {
        setShowReschedule(false);
        setRescheduleReason("");
      }
    });
  }

  function park() {
    setError(null);
    startTransition(async () => {
      const result = await parkCommitmentAction(commitment.id);
      if (!result.ok) setError(result.message);
      else setJustResolved("parked");
    });
  }

  function submitUnpark() {
    setError(null);
    startTransition(async () => {
      const result = await unparkCommitmentAction(commitment.id, unparkDate);
      if (!result.ok) setError(result.message);
      else setShowUnpark(false);
    });
  }

  function stopRepeating() {
    setError(null);
    startTransition(async () => {
      const result = await stopRepeatingAction(commitment.id);
      if (!result.ok) setError(result.message);
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

  const canDelete =
    isAdmin || (commitment.owner_id === currentUserId && isOpen);

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
    setShowActionMenu((prev) => !prev);
  }

  function menuChoose(
    action:
      | "kept"
      | "missed"
      | "reschedule"
      | "park"
      | "stop_repeating"
      | "unpark"
      | "reopen"
  ) {
    setShowActionMenu(false);
    setError(null);
    if (action === "kept") {
      // Overdue + non-admin: show the late-reason strip with Skip.
      // Admins skip the prompt entirely; on-time keeps never prompt.
      if (isOverdue && !isAdmin) {
        setShowLateReason(true);
      } else {
        markKept(null);
      }
    } else if (action === "missed") {
      // Admins bypass the reason strip — mark immediately.
      if (isAdmin) {
        setError(null);
        startTransition(async () => {
          const result = await markMissedAction(commitment.id, null);
          if (!result.ok) setError(result.message);
          else setJustResolved("missed");
        });
      } else {
        setShowReason(true);
      }
    } else if (action === "reschedule") {
      setRescheduleDate(commitment.due_date);
      setShowReschedule(true);
    } else if (action === "park") {
      park();
    } else if (action === "stop_repeating") {
      stopRepeating();
    } else if (action === "unpark") {
      setUnparkDate(todayIso);
      setShowUnpark(true);
    } else if (action === "reopen") {
      if (isKept) unmarkKept();
      else if (isMissed) unmarkMissed();
    }
  }

  const isActive = isOpen;

  return (
    <li
      className={
        isParked
          ? `${styles.row} ${styles.rowResolved}`
          : isActive
            ? styles.row
            : `${styles.row} ${styles.rowResolved}`
      }
    >
      <button
        type="button"
        className={buildCircleClass(
          isKeptOnTime,
          isKeptLate,
          isMissed,
          isOverdue
        )}
        onClick={onCircleClick}
        disabled={pending || !canResolve}
        data-state={
          isKeptOnTime
            ? "kept_on_time"
            : isKeptLate
              ? "kept_late"
              : isMissed
                ? "missed"
                : isParked
                  ? "parked"
                  : "open"
        }
        aria-haspopup="menu"
        aria-expanded={showActionMenu}
        title={
          isKeptOnTime
            ? "Kept on time — open actions"
            : isKeptLate
              ? "Kept, late — open actions"
              : isMissed
                ? "Missed — open actions"
                : isParked
                  ? "Parked — open actions"
                  : isOverdue
                    ? "Overdue — open actions"
                    : "Open actions"
        }
        aria-label="Open actions"
        aria-pressed={isKept || isMissed}
      >
        <span
          className={styles.checkmark}
          aria-hidden
          style={
            isKept || isMissed
              ? undefined
              : { color: "var(--text-muted)" }
          }
        >
          {isMissed ? "✕" : isKeptLate ? "✓" : "✓"}
        </span>
        {isKeptLate ? (
          <span
            aria-hidden
            title="Kept, late"
            style={{
              position: "absolute",
              bottom: -2,
              right: -2,
              fontSize: 10,
              lineHeight: 1,
              background: "var(--aims-white, #fff)",
              borderRadius: "50%",
              padding: "1px 2px",
            }}
          >
            🕒
          </span>
        ) : null}
      </button>

      {showActionMenu ? (
        <div
          ref={menuRef}
          className={styles.resolveMenu}
          role="menu"
          aria-label="Commitment actions"
        >
          {isParked ? (
            <button
              type="button"
              className={styles.resolveMenuItem}
              role="menuitem"
              onClick={() => menuChoose("unpark")}
            >
              <span aria-hidden>↻</span> Bring back
            </button>
          ) : isActive ? (
            <>
              <button
                type="button"
                className={styles.resolveMenuItemKept}
                role="menuitem"
                onClick={() => menuChoose("kept")}
              >
                <span aria-hidden>✓</span>{" "}
                {isOverdue ? "Mark kept (late)" : "Mark kept"}
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
              <button
                type="button"
                className={styles.resolveMenuItem}
                role="menuitem"
                onClick={() => menuChoose("reschedule")}
              >
                <span aria-hidden>→</span> Reschedule
              </button>
              <button
                type="button"
                className={styles.resolveMenuItem}
                role="menuitem"
                onClick={() => menuChoose("park")}
              >
                <span aria-hidden>⏸</span> Park
              </button>
              {isOngoing ? (
                <button
                  type="button"
                  className={styles.resolveMenuItem}
                  role="menuitem"
                  onClick={() => menuChoose("stop_repeating")}
                >
                  <span aria-hidden>⏹</span> Stop repeating
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
            {isOngoing ? (
              <span
                className={styles.fromMeetingChip}
                title="Repeats weekly — resolving rolls the due date forward"
              >
                Ongoing (weekly)
              </span>
            ) : null}
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
              justResolved === "kept_on_time" || justResolved === "kept_late"
                ? styles.justResolvedKept
                : justResolved === "missed"
                  ? styles.justResolvedMissed
                  : styles.justResolvedInProgress
            }
            role="status"
            aria-live="polite"
          >
            {justResolved === "kept_on_time"
              ? "Marked kept"
              : justResolved === "kept_late"
                ? "Marked kept (late)"
                : justResolved === "missed"
                  ? "Marked missed"
                  : "Parked"}
            {justResolved !== "parked" ? (
              <button
                type="button"
                className={styles.undoLink}
                onClick={
                  justResolved === "missed" ? unmarkMissed : unmarkKept
                }
                disabled={pending}
              >
                Undo
              </button>
            ) : null}
          </span>
        ) : null}
        {error ? (
          <p
            role="alert"
            className={styles.reasonNote}
            style={{ color: "var(--aims-danger)" }}
          >
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
        const dueAssigned = commitment.clarity_timeline === false;
        const assignedTitle = dueAssigned
          ? "No deadline was agreed in the meeting — this date is a placeholder. Reschedule to lock in a real one."
          : undefined;

        if (isParked) {
          return (
            <span
              className={styles.rowDue}
              title="Parked — no scheduled date"
              style={{ color: "var(--text-muted)" }}
            >
              Parked
            </span>
          );
        }

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
              aria-label={assignedTitle ?? "Reschedule"}
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

      {/* Missed reason strip: only shown for non-admin owners. Admin
          missed clicks bypass the strip entirely (see menuChoose). */}
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
              onClick={submitMissed}
              disabled={pending || !reason.trim()}
            >
              {pending ? "Saving…" : "Mark missed"}
            </button>
          </div>
        </div>
      ) : null}

      {/* Late-keep reason strip: reason optional, ghost Skip button.
          Owners see this when they keep an overdue commitment; admins
          skip the prompt entirely and mark kept in one click. */}
      {showLateReason && isOverdue ? (
        <div className={styles.resolveStrip}>
          <label
            htmlFor={`late-reason-${commitment.id}`}
            className={styles.stripLabel}
          >
            What slowed it down? (optional)
          </label>
          <textarea
            id={`late-reason-${commitment.id}`}
            className={styles.stripTextarea}
            value={lateReason}
            onChange={(e) => setLateReason(e.target.value)}
            rows={2}
            disabled={pending}
            placeholder="Anything worth remembering — or leave blank and skip."
            autoFocus
          />
          <div className={styles.stripSubmitRow}>
            <button
              type="button"
              className={styles.ghostButton}
              onClick={() => markKept(null)}
              disabled={pending}
            >
              Skip
            </button>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => markKept(lateReason.trim() || null)}
              disabled={pending}
            >
              {pending ? "Saving…" : "Mark kept (late)"}
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
          {!isAdmin ? (
            <>
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
            </>
          ) : null}
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
                (!isAdmin && !rescheduleReason.trim()) ||
                !rescheduleDate ||
                rescheduleDate === commitment.due_date
              }
            >
              {pending ? "Saving…" : "Reschedule"}
            </button>
          </div>
        </div>
      ) : null}

      {showUnpark && isParked ? (
        <div className={styles.resolveStrip}>
          <label
            htmlFor={`unpark-date-${commitment.id}`}
            className={styles.stripLabel}
          >
            Bring back with due date
          </label>
          <input
            id={`unpark-date-${commitment.id}`}
            type="date"
            className={styles.stripInput}
            value={unparkDate}
            onChange={(e) => setUnparkDate(e.target.value)}
            disabled={pending}
          />
          <div className={styles.stripSubmitRow}>
            <button
              type="button"
              className={styles.ghostButton}
              onClick={() => setShowUnpark(false)}
              disabled={pending}
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={submitUnpark}
              disabled={pending || !unparkDate}
            >
              {pending ? "Saving…" : "Bring back"}
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
  isKeptOnTime: boolean,
  isKeptLate: boolean,
  isMissed: boolean,
  isOverdue: boolean
): string {
  const parts = [styles.resolveCircle];
  if (isKeptOnTime || isKeptLate) parts.push(styles.resolveCircleChecked);
  if (isMissed) parts.push(styles.resolveCircleClosed);
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
