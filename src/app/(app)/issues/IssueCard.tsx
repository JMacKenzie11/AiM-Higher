"use client";

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
  type CommitmentResult,
} from "@/lib/commitments/actions";
import {
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

  return (
    <article className={styles.issueRow}>
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
            <ClarityChip
              state={clarityState(active)}
              onClick={
                canEditClarity
                  ? () => setShowClarity((prev) => !prev)
                  : undefined
              }
            />
            <span className={styles.commitmentText}>{active.description}</span>
          </div>
          <div className={styles.cellOwner}>{activeOwner ?? "Unassigned"}</div>
          <div className={styles.cellDue}>{active.due_date}</div>
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
  if (editing) {
    return (
      <>
        <input
          type="text"
          className={styles.wantInput}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
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
  if (issue.desired_outcome) {
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
  return (
    <button
      type="button"
      className={`${styles.wantEditable} ${styles.wantMuted}`}
      onClick={() => setEditing(true)}
      title="Click to add"
    >
      What&rsquo;s the outcome you want here?
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
  const inputRef = useRef<HTMLInputElement>(null);
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
        <input
          ref={inputRef}
          type="text"
          name="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
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
