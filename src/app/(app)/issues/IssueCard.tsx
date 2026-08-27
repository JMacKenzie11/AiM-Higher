"use client";

import { useRouter } from "next/navigation";
import {
  useActionState,
  useEffect,
  useRef,
  useState,
  useTransition,
  type HTMLAttributes,
} from "react";
import {
  createCommitmentAction,
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
  // Take the newest open commitment as "this week's". If more than
  // one exists, older ones stay linked in the DB but don't render
  // here — the row's premise is a single current commitment.
  const openCommitments = issue.commitments
    .filter((c) => c.status === "open" && !c.deleted_at && !c.parked_at)
    .sort((a, b) => (a.created_at > b.created_at ? -1 : 1));
  const active = openCommitments[0] ?? null;
  const activeOwner = active?.owner_id
    ? roster.find((p) => p.id === active.owner_id)?.full_name ?? "Unknown"
    : null;
  // Owner (or their admin) can toggle the extractor's clarity
  // assessment on issue-linked commitments too. Same three-state
  // dot + inline editor as the /commitments row; the difference is
  // just that it lives inside the /issues grid.
  const canEditClarity =
    active !== null &&
    (isAdmin || (active.owner_id !== null && active.owner_id === currentUserId));
  const [showClarity, setShowClarity] = useState(false);
  const [clarityError, setClarityError] = useState<string | null>(null);

  const canEditActive = active !== null && canEditClarity;

  return (
    <article className={styles.issueRow}>
      {/* Col 1: clarity dot (leftmost) — only when a commitment
          exists. No commitment = empty column, keeping the grid
          shape stable across rows. */}
      {active ? (
        <div className={styles.cellClarity}>
          <ClarityChip
            state={clarityState(active)}
            onClick={
              canEditClarity
                ? () => setShowClarity((prev) => !prev)
                : undefined
            }
          />
        </div>
      ) : (
        <span aria-hidden className={styles.cellClarity} />
      )}

      {/* Col 2: drag handle */}
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
      </div>

      <div className={styles.cellWant}>
        <DesiredOutcomeEditor issue={issue} canEdit={canEdit} />
      </div>

      {active ? (
        <>
          <div className={styles.cellCommitment}>
            <CommitmentDescriptionEditor
              commitment={active}
              canEdit={canEditActive}
            />
          </div>
          <div className={styles.cellOwner}>
            <OwnerAssignmentEditor
              commitment={active}
              roster={roster}
              canEdit={canEditActive}
              currentOwnerName={activeOwner}
            />
          </div>
          <div className={styles.cellDue}>
            <DueDateEditor
              commitment={active}
              canEdit={canEditActive}
              isAdmin={isAdmin}
            />
          </div>
        </>
      ) : canEdit ? (
        <IssueCommitmentAddInline
          issueId={issue.id}
          roster={roster}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          todayIso={todayIso}
        />
      ) : (
        <>
          <div className={`${styles.cellCommitment} ${styles.cellMuted}`}>
            No commitment yet.
          </div>
          <div className={styles.cellOwner}>—</div>
          <div className={styles.cellDue}>—</div>
        </>
      )}

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

      {showClarity && active && canEditClarity ? (
        <ClarityEditor
          commitment={active}
          onCancel={() => {
            setShowClarity(false);
            setClarityError(null);
          }}
          onSaved={() => {
            setShowClarity(false);
            setClarityError(null);
          }}
          onError={setClarityError}
        />
      ) : null}
      {clarityError ? (
        <p role="alert" className={styles.rowError}>
          {clarityError}
        </p>
      ) : null}
    </article>
  );
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
        <input
          className={styles.issueTitleInput}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
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
          className={styles.wantInput}
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
// cells in place when the issue has no open commitment. Submitting
// creates an issue-linked commitment; the row rerenders in the
// "show active" branch on next revalidate.
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

  return (
    <>
      <form
        id={`add-cmt-${issueId}`}
        action={formAction}
        className={styles.cellCommitment}
      >
        <input type="hidden" name="issue_id" value={issueId} />
        <input type="hidden" name="owner_id" value={ownerId} />
        <input type="hidden" name="due_date" value={dueDate} />
        <textarea
          ref={inputRef}
          name="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setDescription("");
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
            form={`add-cmt-${issueId}`}
            value={ownerId}
            onChange={(e) => setOwnerId(e.target.value)}
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
          form={`add-cmt-${issueId}`}
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className={styles.commitmentAddDate}
          disabled={pending}
          aria-label="Due date"
        />
      </div>
    </>
  );
}

// ---- Inline editors for the active commitment ------------------
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

  useEffect(() => {
    setDraft(commitment.description);
  }, [commitment.description]);

  function commit() {
    if (pending) return;
    const next = draft.trim();
    if (!next || next === commitment.description) {
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
          className={styles.wantInput}
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
    >
      {commitment.due_date}
    </button>
  );
}
