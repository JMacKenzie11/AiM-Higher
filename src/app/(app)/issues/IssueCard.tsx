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
import type { Profile } from "@/lib/types";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { CommitmentRow } from "../commitments/CommitmentRow";
import styles from "./issues.module.css";

// One issue card: title (inline rename), "WHAT WE WANT" body
// (inline editable), the issue's commitments rendered as full
// CommitmentRow instances (all resolve/reschedule mechanics
// intact), and an inline add row scoped to this issue.
// Resolve action lives in the header actions row.

const CREATE_INITIAL: CommitmentResult = { ok: false, message: "" };

export function IssueCard({
  issue,
  roster,
  todayIso,
  currentUserId,
  currentUserCompanyId,
  isAdmin,
  dragHandleProps,
}: {
  issue: IssueWithCommitments;
  roster: Array<Pick<Profile, "id" | "full_name">>;
  todayIso: string;
  currentUserId: string;
  currentUserCompanyId: string | null;
  isAdmin: boolean;
  dragHandleProps?: HTMLAttributes<HTMLButtonElement>;
}) {
  const canEdit = isAdmin || issue.created_by === currentUserId;
  const openCommitments = issue.commitments.filter(
    (c) => c.status === "open" && !c.deleted_at && !c.parked_at
  );

  return (
    <article className={styles.issueCard}>
      <header className={styles.issueHeader}>
        <div className={styles.issueHeaderLeft}>
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
          ) : null}
          <IssueTitleEditor issue={issue} canEdit={canEdit} />
        </div>
        {canEdit ? <ResolveIssueButton issueId={issue.id} /> : null}
      </header>

      <section className={styles.issueSection} aria-labelledby={`want-${issue.id}`}>
        <h3 id={`want-${issue.id}`} className={styles.issueSectionLabel}>
          What we want
        </h3>
        <DesiredOutcomeEditor issue={issue} canEdit={canEdit} />
      </section>

      <section
        className={styles.issueSection}
        aria-labelledby={`work-${issue.id}`}
      >
        <h3 id={`work-${issue.id}`} className={styles.issueSectionLabel}>
          This week&rsquo;s commitment
        </h3>
        {openCommitments.length === 0 && !canEdit ? (
          <p className={styles.emptyLine}>No commitment yet.</p>
        ) : null}
        {openCommitments.length > 0 ? (
          <ul className={styles.commitmentList}>
            {openCommitments.map((c) => (
              <CommitmentRow
                key={c.id}
                commitment={c}
                // Issue-linked commitments don't take a priority.
                // Empty options + canLink=false hides the picker;
                // the Phase 2 chip-plus-menu will replace the picker
                // with a chip that can re-target the link.
                priorityOptions={[]}
                roster={roster}
                todayIso={todayIso}
                canResolve={
                  isAdmin ||
                  c.owner_id === currentUserId ||
                  (currentUserCompanyId !== null &&
                    c.company_id === currentUserCompanyId)
                }
                canLink={false}
                canReassign={
                  isAdmin ||
                  c.owner_id === currentUserId ||
                  c.owner_id === null
                }
                currentUserId={currentUserId}
                isAdmin={isAdmin}
              />
            ))}
          </ul>
        ) : null}
        {canEdit ? (
          <IssueCommitmentAddRow
            issueId={issue.id}
            roster={roster}
            currentUserId={currentUserId}
            isAdmin={isAdmin}
            todayIso={todayIso}
          />
        ) : null}
      </section>
    </article>
  );
}

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
    return <h2 className={styles.issueTitle}>{issue.title}</h2>;
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
      <p className={styles.issueBody}>{issue.desired_outcome}</p>
    ) : (
      <p className={styles.issueBodyMuted}>Not yet defined.</p>
    );
  }
  if (editing) {
    return (
      <>
        <textarea
          className={styles.issueBodyInput}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setDraft(issue.desired_outcome ?? "");
              setEditing(false);
              setError(null);
            }
          }}
          rows={2}
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
        className={styles.issueBodyEditable}
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
      className={`${styles.issueBodyEditable} ${styles.issueBodyMuted}`}
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

function IssueCommitmentAddRow({
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
    <form action={formAction} className={styles.commitmentAddRow}>
      <input type="hidden" name="issue_id" value={issueId} />
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
      {isAdmin ? (
        <select
          name="owner_id"
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
      ) : null}
      <input
        type="date"
        name="due_date"
        value={dueDate}
        onChange={(e) => setDueDate(e.target.value)}
        className={styles.commitmentAddDate}
        disabled={pending}
        aria-label="Due date"
      />
      {pending ? (
        <span className={styles.savingHint}>Saving…</span>
      ) : null}
      {errorMessage ? (
        <p role="alert" className={styles.rowError}>
          {errorMessage}
        </p>
      ) : null}
    </form>
  );
}
