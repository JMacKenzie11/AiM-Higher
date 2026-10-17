"use client";

import { useState, useTransition, type HTMLAttributes } from "react";
import { resolveIssueAction } from "@/lib/issues/actions";
import type { IssueWithCommitments } from "@/lib/issues/service";
import type { Priority, Profile } from "@/lib/types";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { NeedsRewordingTag } from "@/components/ui/NeedsRewordingTag";
import { useRegisterIssue, useWorkDrawer } from "@/components/work-drawer/context";
import styles from "./issues.module.css";

// One issue = one line (Jason, 2026-10-16): the drag handle, Resolve,
// the description, a count of its open commitments when it has any,
// and Delete. Everything else is in the drawer the description opens
// (components/work-drawer): the description and what we want, edited
// there, its notes, and its commitments with the line to add one.
//
// The drawer reads this issue from the registry it registers into
// here, so after a save the open drawer shows what the row shows.

export function IssueCard({
  issue,
  roster,
  priorityOptions,
  todayIso,
  currentUserId,
  isAdmin,
  dragHandleProps,
}: {
  issue: IssueWithCommitments;
  roster: Array<Pick<Profile, "id" | "full_name">>;
  priorityOptions: Array<Pick<Priority, "id" | "title">>;
  todayIso: string;
  currentUserId: string;
  isAdmin: boolean;
  dragHandleProps?: HTMLAttributes<HTMLButtonElement>;
}) {
  const canEdit = isAdmin || issue.created_by === currentUserId;
  const drawer = useWorkDrawer();
  // Adding a commitment on it follows editing it, as the add line under
  // each issue always did.
  useRegisterIssue(issue, { roster, priorityOptions, todayIso, currentUserId, isAdmin, canEdit, canAdd: canEdit });

  // Open means still to do: not finished and not parked. The same set
  // Resolve offers to close, since parked and ongoing rows are left
  // alone server-side.
  const open = issue.commitments.filter((c) => c.status === "open" && c.parked_at === null);
  const resolvable = open.filter((c) => !c.is_ongoing).length;

  if (drawer?.isIssueHidden(issue.id)) return null;

  return (
    // Anchored so an old /issues#issue-<id> link still lands on the
    // row; the page opens the drawer for ?issue=<id>.
    <article className={styles.issueLine} id={`issue-${issue.id}`}>
      {canEdit ? (
        <button
          type="button"
          className={styles.dragHandle}
          aria-label="Reorder this issue"
          title="Drag to reorder"
          {...dragHandleProps}
        >
          <span aria-hidden="true">⠿</span>
        </button>
      ) : (
        <span aria-hidden className={styles.dragHandlePlaceholder} />
      )}

      {canEdit ? (
        <ResolveIssueButton issueId={issue.id} openCount={resolvable} />
      ) : (
        <span aria-hidden className={styles.resolvePlaceholder} />
      )}

      <div className={styles.lineMain}>
        <button
          type="button"
          className={styles.lineTitle}
          onClick={() => drawer?.openIssue(issue.id)}
          title="Open"
        >
          {issue.title}
        </button>
        {/* For whoever can reword it (0250). */}
        {issue.needs_rewording && canEdit ? <NeedsRewordingTag /> : null}
      </div>

      {open.length > 0 ? (
        <span
          className={styles.openBadge}
          title={`${open.length} open ${open.length === 1 ? "commitment" : "commitments"}`}
          aria-label={`${open.length} open ${open.length === 1 ? "commitment" : "commitments"}`}
        >
          {open.length}
        </span>
      ) : null}

      {isAdmin ? (
        <button
          type="button"
          className={styles.deleteButton}
          // No confirmation box: the row goes at once and the undo chip
          // brings it back for 30 seconds, as a commitment's does.
          onClick={() => drawer?.deleteIssueWithUndo(issue.id)}
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
      ) : (
        <span aria-hidden className={styles.deletePlaceholder} />
      )}
    </article>
  );
}

// Labels the commitment columns inside a resolved issue
// (ResolvedIssuesList), which still lists its commitments in place.
//
// PLACED, not counted: each label sits in its column by class, so the
// header cannot drift from the cells under it.
export function CommitmentSubHeader() {
  return (
    <div className={styles.commitmentSubHeader} role="row" aria-hidden="true">
      <span className={styles.addDescription}>Commitment</span>
      <span className={styles.addOwner}>Assigned to</span>
      <span className={styles.addDue}>Due date</span>
      <span className={styles.subHeadStatus}>Status</span>
    </div>
  );
}

function ResolveIssueButton({
  issueId,
  openCount,
}: {
  issueId: string;
  openCount: number;
}) {
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
      {/* The same circle a commitment carries, so "resolve this thing"
          is one gesture with one look wherever you meet it. It never
          resolves on the click: the confirm dialog is the second
          gesture, as the commitment circle's menu is. */}
      <button
        type="button"
        className={styles.issueResolveCircle}
        onClick={() => setConfirming(true)}
        disabled={pending}
        title="Resolve this issue"
        aria-label="Resolve this issue"
      >
        <span aria-hidden className={styles.issueResolveCheck}>
          ✓
        </span>
      </button>
      <ConfirmDialog
        open={confirming}
        title="Resolve this issue?"
        message={
          openCount > 0
            ? `It moves off the open list, and ${
                openCount === 1
                  ? "the commitment"
                  : openCount === 2
                    ? "both commitments"
                    : `all ${openCount} commitments`
              } still open on it will be marked kept.`
            : "It moves off the open list."
        }
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
