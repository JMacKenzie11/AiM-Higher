"use client";

import { useRouter } from "next/navigation";
import {
  useActionState,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
  type HTMLAttributes,
} from "react";
import {
  createCommitmentAction,
  deleteCommitmentAction,
  markKeptAction,
  reassignCommitmentAction,
  rescheduleCommitmentAction,
  updateCommitmentDescriptionAction,
  type CommitmentResult,
} from "@/lib/commitments/actions";
import type { Commitment } from "@/lib/types";
import {
  deleteIssueAction,
  renameIssueAction,
  resolveIssueAction,
  updateIssueDesiredOutcomeAction,
} from "@/lib/issues/actions";
import type { IssueWithCommitments } from "@/lib/issues/service";
import type { Priority, Profile } from "@/lib/types";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  ClarityChip,
  ClarityEditor,
  clarityState,
} from "../commitments/ClarityStrip";
import { splitThread, needsReview } from "@/lib/issues/thread";
import type { CommitmentWithMeta } from "@/lib/commitments/service";
import { formatShortDate } from "@/lib/dates";
import styles from "./issues.module.css";

// One issue = one row. Five columns match the /commitments visual
// vocabulary: Issue | What we want | Commitment | Assigned To |
// Due Date. Drag handle on the far left, Resolve on the far right.
//
// The commitment column shows the newest open issue-linked
// commitment (there's typically one at a time for a Solution
// Seeking flow). If there's none, the last three columns collapse
// into a compact inline "add commitment" form so the meeting
// leader can capture what will move the issue forward this week
// without leaving the row.
//
// Owner-facing commitment mechanics (mark kept / reschedule /
// reassign) live on Guide HQ "My commitments" per the presentation
// rule — issue-linked commitments stay off the company /commitments
// page but are always present on personal surfaces where the owner
// interacts with them.

// _priority + _fnArea props are unused for now; kept in the signature
// so future work (chip-in-place, click-to-edit link) doesn't have to
// re-thread them from the page loader.

const CREATE_INITIAL: CommitmentResult = { ok: false, message: "" };

export function IssueCard({
  issue,
  roster,
  todayIso,
  currentUserId,
  isAdmin,
  dragHandleProps,
}: {
  issue: IssueWithCommitments;
  roster: Array<Pick<Profile, "id" | "full_name">>;
  priorityOptions: Array<Pick<Priority, "id" | "title">>;
  functionalAreaOptions: Array<{ id: string; title: string }>;
  todayIso: string;
  currentUserId: string;
  currentUserCompanyId: string | null;
  isAdmin: boolean;
  dragHandleProps?: HTMLAttributes<HTMLButtonElement>;
}) {
  const canEdit = isAdmin || issue.created_by === currentUserId;
  // An issue is worked through a SEQUENCE of commitments. See
  // lib/issues/thread.ts for the derivation, and for why each clause
  // of the review condition is load-bearing.
  //
  // `thread.active` is deliberately not read here. It still exists
  // because the derivation has to order the open commitments somehow,
  // but this card no longer treats one of them differently from the
  // others — that distinction was the bug, not the feature.
  const thread = splitThread(issue.commitments);
  const doneCount = thread.completed.length;
  const awaitingReview = needsReview(issue, thread);
  const [expanded, setExpanded] = useState(false);
  const [showClarityFor, setShowClarityFor] = useState<string | null>(null);

  // EVERY COMMITMENT ON AN ISSUE IS THE SAME KIND OF THING.
  //
  // The first version gave one of them the row's three commitment
  // columns and rendered the rest as second-class lines underneath.
  // That hierarchy was never in the domain — it came from the grid
  // having exactly three commitment-shaped cells — and it produced
  // three separate defects in a day: an unreachable add affordance,
  // a second commitment displacing the first, and a review prompt
  // wedged into a cell too narrow for it.
  //
  // So there is no "active" commitment any more. Open commitments are
  // lines, the add form is the last line, and they all use the same
  // three columns via `subgrid` so the COMMITMENT / ASSIGNED TO /
  // DUE DATE headers still describe every one of them.
  //
  // Finished ones stay collapsed behind "N done" — the one place the
  // uniform rule bends, deliberately, because an issue with eight
  // finished commitments would otherwise bury the live ones.
  const ownerNameFor = (c: CommitmentWithMeta): string | null =>
    c.owner_id
      ? roster.find((p) => p.id === c.owner_id)?.full_name ?? "Unknown"
      : null;
  const canEditCommitment = (c: CommitmentWithMeta): boolean =>
    isAdmin || (c.owner_id !== null && c.owner_id === currentUserId);

  const openCommitments = thread.active
    ? [thread.active, ...thread.otherOpen]
    : thread.otherOpen;

  return (
    // Anchored so /commitments can link straight to this row. There
    // is no issue detail page to link to — unlike a meeting, which
    // has one — so the row itself is the destination.
    <article className={styles.issueRow} id={`issue-${issue.id}`}>
      {canEdit ? (
        <button
          type="button"
          className={styles.dragHandle}
          aria-label="Reorder this issue"
          title="Drag to reorder"
          {...dragHandleProps}
        >
          <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden>
            <circle cx="5" cy="4" r="1.2" fill="currentColor" />
            <circle cx="11" cy="4" r="1.2" fill="currentColor" />
            <circle cx="5" cy="8" r="1.2" fill="currentColor" />
            <circle cx="11" cy="8" r="1.2" fill="currentColor" />
            <circle cx="5" cy="12" r="1.2" fill="currentColor" />
            <circle cx="11" cy="12" r="1.2" fill="currentColor" />
          </svg>
        </button>
      ) : (
        <span aria-hidden className={styles.dragHandlePlaceholder} />
      )}

      <div className={styles.cellIssue}>
        <IssueTitleEditor issue={issue} canEdit={canEdit} />
        {/* Derived state, not a status value: unresolved, nothing
            open, at least one thing finished. */}
        {awaitingReview ? (
          <span className={styles.needsReviewBadge}>needs review</span>
        ) : null}
      </div>

      <div className={styles.cellWant}>
        <DesiredOutcomeEditor issue={issue} canEdit={canEdit} />
      </div>

      {/* The commitments region: spans the three commitment columns
          and lays its lines out on `subgrid`, so every line aligns to
          the same headers no matter how many there are. */}
      <div className={styles.commitments}>
        {doneCount > 0 && expanded
          ? thread.completed.map((done) => (
              <DoneCommitmentLine
                key={done.id}
                commitment={done}
                ownerName={ownerNameFor(done)}
              />
            ))
          : null}

        {openCommitments.map((c) => (
          <OpenCommitmentLine
            key={c.id}
            commitment={c}
            roster={roster}
            ownerName={ownerNameFor(c)}
            canEdit={canEditCommitment(c)}
            isAdmin={isAdmin}
            showClarity={showClarityFor === c.id}
            onToggleClarity={() =>
              setShowClarityFor((prev) => (prev === c.id ? null : c.id))
            }
          />
        ))}

        {/* The review moment, as one quiet line at the end of the
            thread rather than a block inside a narrow cell. */}
        {awaitingReview && canEdit ? (
          <ReviewPromptLine issueId={issue.id} />
        ) : null}

        {canEdit ? (
          <IssueCommitmentAddInline
            issueId={issue.id}
            roster={roster}
            currentUserId={currentUserId}
            isAdmin={isAdmin}
            todayIso={todayIso}
          />
        ) : openCommitments.length === 0 ? (
          <p className={styles.commitmentEmpty}>No commitment yet.</p>
        ) : null}

        {doneCount > 0 ? (
          <button
            type="button"
            className={styles.threadToggle}
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={`${expanded ? "Hide" : "Show"} ${doneCount} finished commitment${doneCount === 1 ? "" : "s"}`}
          >
            {expanded ? "hide finished" : `${doneCount} done`}
          </button>
        ) : null}
      </div>

      {isAdmin ? (
        <DeleteIssueButton issueId={issue.id} issueTitle={issue.title} />
      ) : (
        <span aria-hidden className={styles.deletePlaceholder} />
      )}

      {canEdit ? (
        <ResolveIssueButton issueId={issue.id} />
      ) : (
        <span aria-hidden className={styles.resolvePlaceholder} />
      )}
    </article>
  );
}

// Auto-size a textarea to fit its content. Fixed `rows` clips long
// text on open ("shrinks" the cell); this resets height to auto +
// scrollHeight on every keystroke so the box grows and shrinks with
// the value. Runs in useLayoutEffect so the sizing lands before
// paint — no visible jump on mount.
function useAutoResize(
  ref: React.RefObject<HTMLTextAreaElement | null>,
  active: boolean,
  value: string
) {
  useLayoutEffect(() => {
    if (!active || !ref.current) return;
    ref.current.style.height = "auto";
    ref.current.style.height = `${ref.current.scrollHeight}px`;
  }, [ref, active, value]);
}

// ---- Inline editors -------------------------------------------

function IssueTitleEditor({
  issue,
  canEdit,
}: {
  issue: IssueWithCommitments;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(issue.title);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useAutoResize(inputRef, editing, draft);

  useEffect(() => {
    setDraft(issue.title);
  }, [issue.title]);

  function commit() {
    if (pending) return;
    const next = draft.trim();
    if (!next || next === issue.title) {
      setDraft(issue.title);
      setEditing(false);
      setError(null);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await renameIssueAction(issue.id, next);
      if (!result.ok) setError(result.message);
      else setEditing(false);
    });
  }

  if (!canEdit) {
    return <span className={styles.issueTitle}>{issue.title}</span>;
  }
  if (editing) {
    return (
      <>
        <textarea
          ref={inputRef}
          className={styles.issueTitleInput}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          rows={1}
          onKeyDown={(e) => {
            // Enter commits (titles are single-thought lines, not
            // paragraphs) — matches the click-and-type UX of the
            // original single-line input. Escape reverts.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setDraft(issue.title);
              setEditing(false);
              setError(null);
            }
          }}
          autoFocus
          disabled={pending}
          aria-label="Edit issue title"
        />
        {error ? (
          <p role="alert" className={styles.rowError}>
            {error}
          </p>
        ) : null}
      </>
    );
  }
  return (
    <button
      type="button"
      className={styles.issueTitleEditable}
      onClick={() => setEditing(true)}
      title="Click to rename"
      // Safari skips <button> from the default tab order (only inputs/
      // textareas are included unless the user turned on Full Keyboard
      // Access system-wide). tabIndex={0} forces Safari to tab into
      // this button so the click-to-edit row is keyboard-navigable
      // across every browser.
      tabIndex={0}
    >
      {issue.title}
    </button>
  );
}

function DesiredOutcomeEditor({
  issue,
  canEdit,
}: {
  issue: IssueWithCommitments;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(issue.desired_outcome ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const emptyRef = useRef<HTMLTextAreaElement>(null);
  useAutoResize(editRef, editing, draft);
  useAutoResize(emptyRef, !issue.desired_outcome && !editing, draft);

  useEffect(() => {
    setDraft(issue.desired_outcome ?? "");
  }, [issue.desired_outcome]);

  function commit() {
    if (pending) return;
    if (draft.trim() === (issue.desired_outcome ?? "").trim()) {
      setEditing(false);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await updateIssueDesiredOutcomeAction(issue.id, draft);
      if (!result.ok) setError(result.message);
      else setEditing(false);
    });
  }

  if (!canEdit) {
    return issue.desired_outcome ? (
      <span className={styles.wantText}>{issue.desired_outcome}</span>
    ) : (
      <span className={styles.wantMuted}>Not yet defined.</span>
    );
  }
  // Empty state renders the same dashed-textarea shape as the
  // Commitment add cell, so the two "please fill me in" surfaces
  // look identical instead of one being a muted italic prompt.
  // Focus is left to the user; onBlur saves what they typed.
  if (!issue.desired_outcome && !editing) {
    return (
      <>
        <textarea
          ref={emptyRef}
          className={styles.commitmentAddInput}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          rows={3}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setDraft("");
              setError(null);
            }
          }}
          placeholder="What's the outcome you want here?"
          disabled={pending}
          aria-label="What we want"
        />
        {error ? (
          <p role="alert" className={styles.rowError}>
            {error}
          </p>
        ) : null}
      </>
    );
  }
  if (editing) {
    return (
      <>
        <textarea
          ref={editRef}
          className={styles.wantInput}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          rows={1}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setDraft(issue.desired_outcome ?? "");
              setEditing(false);
              setError(null);
            }
          }}
          autoFocus
          disabled={pending}
          aria-label="What we want"
        />
        {error ? (
          <p role="alert" className={styles.rowError}>
            {error}
          </p>
        ) : null}
      </>
    );
  }
  return (
    <button
      type="button"
      className={styles.wantEditable}
      onClick={() => setEditing(true)}
      title="Click to edit"
      tabIndex={0}
    >
      {issue.desired_outcome}
    </button>
  );
}

function ResolveIssueButton({ issueId }: { issueId: string }) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function run() {
    setConfirming(false);
    setError(null);
    startTransition(async () => {
      const result = await resolveIssueAction(issueId);
      if (!result.ok) setError(result.message);
    });
  }

  return (
    <>
      <button
        type="button"
        className={styles.resolveButton}
        onClick={() => setConfirming(true)}
        disabled={pending}
        title="Resolve this issue"
      >
        Resolve
      </button>
      <ConfirmDialog
        open={confirming}
        title="Resolve this issue?"
        message="It moves off the open list. Any open commitments on it stay live and remain yours to resolve as normal."
        confirmLabel="Resolve"
        tone="primary"
        onConfirm={run}
        onCancel={() => setConfirming(false)}
        pending={pending}
      />
      {error ? (
        <p role="alert" className={styles.rowError}>
          {error}
        </p>
      ) : null}
    </>
  );
}

/// Admin/guide-only hard delete. Uses the same trash-icon +
// confirm-dialog pattern as the /commitments row so the two
// surfaces read as siblings. Delete cascades issue_id → null on
// any linked commitments (FK behavior from migration 0143), so
// the commitments stay live and just lose their link.
function DeleteIssueButton({
  issueId,
  issueTitle,
}: {
  issueId: string;
  issueTitle: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function run() {
    setConfirming(false);
    setError(null);
    startTransition(async () => {
      const result = await deleteIssueAction(issueId);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      // revalidatePath() marks /issues stale server-side, but the
      // client route cache still shows the deleted row until the
      // router picks up the new tree. router.refresh() forces the
      // re-render immediately so the row disappears without a
      // page reload.
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        className={styles.deleteButton}
        onClick={() => setConfirming(true)}
        disabled={pending}
        aria-label="Delete this issue"
        title="Delete this issue"
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
      <ConfirmDialog
        open={confirming}
        title="Delete this issue?"
        message={`This can't be undone. "${issueTitle}" will be removed from the list. Any linked commitments stay live but lose their issue linkage.`}
        confirmLabel="Delete"
        tone="danger"
        onConfirm={run}
        onCancel={() => setConfirming(false)}
        pending={pending}
      />
      {error ? (
        <p role="alert" className={styles.rowError}>
          {error}
        </p>
      ) : null}
    </>
  );
}

// Inline commitment-add: fills the three commitment/owner/due
// cells in place when the issue has no open commitment. The form
// action fires createCommitmentAction (which also autoscores the
// commitment's clarity), and revalidates /issues so the row
// rerenders in the "show active" branch on the next paint.
//
// Submit triggers: the "Add" pill under the textarea, or Cmd/Ctrl+
// Enter from inside the textarea. A bare Enter inserts a newline
// (matches the click-to-edit description behavior used elsewhere)
// so multi-sentence commitments can be typed inline.
function IssueCommitmentAddInline({
  issueId,
  roster,
  currentUserId,
  isAdmin,
  todayIso,
}: {
  issueId: string;
  roster: Array<Pick<Profile, "id" | "full_name">>;
  currentUserId: string;
  isAdmin: boolean;
  todayIso: string;
}) {
  const [state, formAction, pending] = useActionState<
    CommitmentResult,
    FormData
  >(createCommitmentAction, CREATE_INITIAL);
  const [description, setDescription] = useState("");
  const [ownerId, setOwnerId] = useState<string>(currentUserId);
  const [dueDate, setDueDate] = useState(todayIso);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  useAutoResize(inputRef, true, description);
  const errorMessage =
    state && "ok" in state && !state.ok && state.message ? state.message : null;

  useEffect(() => {
    if (state && "ok" in state && state.ok) {
      setDescription("");
      setDueDate(todayIso);
      setOwnerId(currentUserId);
      inputRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Blur-save: only submit when focus leaves the form entirely
  // (not when the user tabs between description → owner → date).
  // setTimeout defers the check by a tick so document.activeElement
  // has settled on the NEW focus target — if it's still inside this
  // form, we're just tabbing between fields and shouldn't submit.
  const formId = `add-cmt-${issueId}`;
  const inputId = `${formId}-description`;
  function maybeAutoSubmit() {
    setTimeout(() => {
      const active = document.activeElement;
      const stillInForm =
        active instanceof HTMLElement &&
        (active.getAttribute("form") === formId ||
          active.closest(`form[id="${formId}"]`) !== null);
      if (stillInForm) return;
      if (!description.trim() || pending) return;
      formRef.current?.requestSubmit();
    }, 0);
  }

  return (
    <>
      <form
        id={formId}
        ref={formRef}
        action={formAction}
        className={styles.addLine}
      >
        <input type="hidden" name="issue_id" value={issueId} />
        <input type="hidden" name="owner_id" value={ownerId} />
        <input type="hidden" name="due_date" value={dueDate} />
        {/* A LABEL, not a decorative span. Filled and coloured, it
            reads as a button, and a thing that looks like a button
            has to do something when clicked. As a label it focuses
            the textarea natively and adds no extra tab stop, so the
            keyboard path is unchanged. */}
        <label htmlFor={inputId} className={styles.addCircle}>
          <span aria-hidden>+</span>
          <span className={styles.srOnly}>Add a commitment</span>
        </label>
        <textarea
          id={inputId}
          ref={inputRef}
          name="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={maybeAutoSubmit}
          rows={1}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setDescription("");
            } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              if (description.trim()) formRef.current?.requestSubmit();
            }
          }}
          className={styles.commitmentAddInput}
          placeholder="What will move this forward this week?"
          required
          disabled={pending}
          aria-label="New commitment"
        />
        {errorMessage ? (
          <p role="alert" className={styles.rowError}>
            {errorMessage}
          </p>
        ) : null}
      </form>
      <div className={styles.cellOwner}>
        {isAdmin ? (
          <select
            form={formId}
            value={ownerId}
            onChange={(e) => setOwnerId(e.target.value)}
            onBlur={maybeAutoSubmit}
            className={styles.commitmentAddSelect}
            disabled={pending}
            aria-label="Owner"
          >
            {roster.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </select>
        ) : (
          roster.find((p) => p.id === currentUserId)?.full_name ?? "You"
        )}
      </div>
      <div className={styles.cellDue}>
        <input
          form={formId}
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          onBlur={maybeAutoSubmit}
          className={styles.commitmentAddDate}
          disabled={pending}
          aria-label="Due date"
        />
      </div>
    </>
  );
}

// ---- The thread ------------------------------------------------





// ---- One commitment, one line -----------------------------------
//
// Each of these renders exactly three children, which land in the
// three subgrid columns of the commitments region: description,
// owner, due date. `display: contents` on the wrapper is what lets a
// component own a row of the parent grid.

// A commitment still in flight. Editable, and closable from here —
// there was previously no way to resolve an issue commitment on this
// page at all, which sent people to /commitments to finish work they
// were looking straight at.
function OpenCommitmentLine({
  commitment,
  roster,
  ownerName,
  canEdit,
  isAdmin,
  showClarity,
  onToggleClarity,
}: {
  commitment: CommitmentWithMeta;
  roster: Array<Pick<Profile, "id" | "full_name">>;
  ownerName: string | null;
  canEdit: boolean;
  isAdmin: boolean;
  showClarity: boolean;
  onToggleClarity: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function close() {
    setError(null);
    startTransition(async () => {
      const result = await markKeptAction(commitment.id);
      if (!result.ok) setError(result.message);
    });
  }

  return (
    <>
      <div className={styles.commitmentCell}>
        {/* ONE control at the start of the line, not two. The check
            and the clarity dot were both circles sitting in front of
            the text, which read as clutter and made it unclear which
            one did the thing. The check leads, because closing is the
            action; clarity trails the text as the annotation it is. */}
        <div className={styles.commitmentLead}>
          <button
            type="button"
            className={styles.closeCommitment}
            onClick={close}
            disabled={pending || !canEdit}
            aria-label={`Mark "${commitment.description}" as done`}
            title={canEdit ? "Mark as done" : "Not yours to resolve"}
          >
            ✓
          </button>
          {/* Wrapped, because the editor returns a FRAGMENT of one or
              two elements depending on state (textarea plus an error
              paragraph while editing). Without this the row's child
              count changes under it and any positional CSS drifts. */}
          <div className={styles.commitmentText}>
            <CommitmentDescriptionEditor
              commitment={commitment}
              canEdit={canEdit}
            />
          </div>
          <ClarityChip
            state={clarityState(commitment)}
            onClick={canEdit ? onToggleClarity : undefined}
          />
        </div>
        {error ? (
          <p role="alert" className={styles.commitmentError}>
            {error}
          </p>
        ) : null}
        {showClarity && canEdit ? (
          <ClarityEditor
            commitment={commitment}
            onCancel={onToggleClarity}
            onSaved={onToggleClarity}
            onError={setError}
          />
        ) : null}
      </div>
      <div className={styles.cellOwner}>
        <OwnerAssignmentEditor
          commitment={commitment}
          roster={roster}
          canEdit={canEdit}
          currentOwnerName={ownerName}
        />
      </div>
      <div className={styles.cellDue}>
        <DueDateEditor
          commitment={commitment}
          canEdit={canEdit}
          isAdmin={isAdmin}
        />
      </div>
    </>
  );
}

// A finished one. Same three columns, read-only: this is history, and
// the place to reopen or reschedule a commitment is the surface where
// it is still live.
function DoneCommitmentLine({
  commitment,
  ownerName,
}: {
  commitment: CommitmentWithMeta;
  ownerName: string | null;
}) {
  const landed = commitment.completed_at ?? commitment.due_date;
  return (
    <>
      <div className={`${styles.commitmentCell} ${styles.commitmentDone}`}>
        <span aria-hidden className={styles.doneCheck}>
          ✓
        </span>
        <span className={styles.doneText}>{commitment.description}</span>
      </div>
      <div className={`${styles.cellOwner} ${styles.commitmentDone}`}>
        {ownerName ?? "—"}
      </div>
      <div className={`${styles.cellDue} ${styles.commitmentDone}`}>
        {landed ? formatShortDate(landed.slice(0, 10)) : "—"}
      </div>
    </>
  );
}

// The review moment. One line spanning all three columns, because it
// is a question about the ISSUE rather than about a commitment — and
// because wedging a question and two buttons into the commitment
// column is what made the first version look cluttered.
function ReviewPromptLine({ issueId }: { issueId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function resolve() {
    setError(null);
    startTransition(async () => {
      const result = await resolveIssueAction(issueId);
      if (!result.ok) setError(result.message);
    });
  }

  return (
    <div className={styles.reviewLine}>
      <span className={styles.reviewAsk}>Did this solve it?</span>
      <button
        type="button"
        className={styles.reviewResolve}
        onClick={resolve}
        disabled={pending}
      >
        {pending ? "Resolving…" : "Resolve issue"}
      </button>
      <span className={styles.reviewOr}>or add another commitment below</span>
      {error ? (
        <span role="alert" className={styles.commitmentError}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

// ---- Inline editors for a commitment ----------------------------
// Click-to-edit description / owner / due date so an issue-linked
// commitment can be tuned without leaving the /issues row. These
// three fields stay editable for as long as the issue is on the
// open list; Resolve moves the issue off this page and the row
// stops rendering entirely.

function CommitmentDescriptionEditor({
  commitment,
  canEdit,
}: {
  commitment: Commitment;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(commitment.description);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useAutoResize(inputRef, editing, draft);

  useEffect(() => {
    setDraft(commitment.description);
  }, [commitment.description]);

  function commit() {
    if (pending) return;
    const next = draft.trim();
    // Empty text = delete the whole commitment. The row falls back
    // to the "add commitment" state and the clarity chip disappears
    // (no commitment to score). Matches the blur-to-save rhythm of
    // every other field on the row.
    if (!next) {
      setError(null);
      startTransition(async () => {
        const result = await deleteCommitmentAction(commitment.id);
        if (!result.ok) {
          setError(result.message);
          setDraft(commitment.description);
        } else {
          setEditing(false);
        }
      });
      return;
    }
    if (next === commitment.description) {
      setDraft(commitment.description);
      setEditing(false);
      setError(null);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await updateCommitmentDescriptionAction(
        commitment.id,
        next
      );
      if (!result.ok) setError(result.message);
      else setEditing(false);
    });
  }

  if (!canEdit) {
    return <span>{commitment.description}</span>;
  }
  if (editing) {
    return (
      <>
        <textarea
          ref={inputRef}
          className={styles.wantInput}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          rows={1}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setDraft(commitment.description);
              setEditing(false);
              setError(null);
            }
          }}
          autoFocus
          disabled={pending}
          aria-label="Edit commitment"
        />
        {error ? (
          <p role="alert" className={styles.rowError}>
            {error}
          </p>
        ) : null}
      </>
    );
  }
  return (
    <button
      type="button"
      className={styles.wantEditable}
      onClick={() => setEditing(true)}
      title="Click to edit — Cmd/Ctrl+Enter saves, Esc cancels"
      tabIndex={0}
    >
      {commitment.description}
    </button>
  );
}

function OwnerAssignmentEditor({
  commitment,
  roster,
  canEdit,
  currentOwnerName,
}: {
  commitment: Commitment;
  roster: Array<Pick<Profile, "id" | "full_name">>;
  canEdit: boolean;
  currentOwnerName: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function change(newOwnerId: string) {
    if (pending || newOwnerId === commitment.owner_id) {
      setEditing(false);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await reassignCommitmentAction(commitment.id, newOwnerId);
      if (!result.ok) setError(result.message);
      setEditing(false);
    });
  }

  if (!canEdit) {
    return <span>{currentOwnerName ?? "Unassigned"}</span>;
  }
  if (editing) {
    return (
      <>
        <select
          className={styles.commitmentAddSelect}
          defaultValue={commitment.owner_id ?? ""}
          onChange={(e) => change(e.target.value)}
          onBlur={() => setEditing(false)}
          autoFocus
          disabled={pending}
          aria-label="Reassign owner"
        >
          {roster.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name}
            </option>
          ))}
        </select>
        {error ? (
          <p role="alert" className={styles.rowError}>
            {error}
          </p>
        ) : null}
      </>
    );
  }
  return (
    <button
      type="button"
      className={styles.wantEditable}
      onClick={() => setEditing(true)}
      title="Click to reassign"
      tabIndex={0}
    >
      {currentOwnerName ?? "Unassigned"}
    </button>
  );
}

function DueDateEditor({
  commitment,
  canEdit,
  isAdmin,
}: {
  commitment: Commitment;
  canEdit: boolean;
  isAdmin: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draftDate, setDraftDate] = useState(commitment.due_date);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraftDate(commitment.due_date);
  }, [commitment.due_date]);

  function save() {
    if (pending) return;
    if (draftDate === commitment.due_date && !reason.trim()) {
      setEditing(false);
      setError(null);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await rescheduleCommitmentAction(
        commitment.id,
        draftDate,
        reason.trim() || null
      );
      if (!result.ok) setError(result.message);
      else {
        setReason("");
        setEditing(false);
      }
    });
  }

  if (!canEdit) {
    return <span>{commitment.due_date}</span>;
  }
  if (editing) {
    return (
      <>
        <input
          type="date"
          value={draftDate}
          onChange={(e) => setDraftDate(e.target.value)}
          className={styles.commitmentAddDate}
          autoFocus
          disabled={pending}
          aria-label="Reschedule due date"
        />
        {/* Reason is required for team members per the reschedule
            server action; admins/guides are exempt. Show the field
            always for non-admins so the save doesn't ping-pong
            through a server error. */}
        {!isAdmin ? (
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why the change?"
            className={styles.commitmentAddInput}
            disabled={pending}
            aria-label="Reason for reschedule"
            style={{ marginTop: 4 }}
          />
        ) : null}
        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className={styles.resolveButton}
          >
            {pending ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => {
              setDraftDate(commitment.due_date);
              setReason("");
              setEditing(false);
              setError(null);
            }}
            disabled={pending}
            className={styles.resolveButton}
          >
            Cancel
          </button>
        </div>
        {error ? (
          <p role="alert" className={styles.rowError}>
            {error}
          </p>
        ) : null}
      </>
    );
  }
  return (
    <button
      type="button"
      className={styles.wantEditable}
      onClick={() => setEditing(true)}
      title="Click to reschedule"
      tabIndex={0}
    >
      {commitment.due_date}
    </button>
  );
}
