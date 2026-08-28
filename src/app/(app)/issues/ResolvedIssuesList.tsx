"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteIssueAction } from "@/lib/issues/actions";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { IssueWithCommitments } from "@/lib/issues/service";
import type { Profile } from "@/lib/types";
import styles from "./issues.module.css";

// Read-only mirror of the Open issues table (Issue / What we want /
// Commitment / Assigned to / Due date). Admins additionally get a
// trash icon to hard-delete resolved issues — used for clearing
// test/junk rows out of history. Non-admins see only the history.
// The parent /issues page wraps this in the commitment-style
// .group + .groupHeader chrome with a count.

export function ResolvedIssuesList({
  items,
  roster,
  isAdmin,
}: {
  items: IssueWithCommitments[];
  roster: Array<Pick<Profile, "id" | "full_name">>;
  isAdmin: boolean;
}) {
  return (
    <div className={styles.resolvedTable}>
      <div
        className={
          isAdmin
            ? styles.resolvedColumnHeaderWithDelete
            : styles.resolvedColumnHeader
        }
        role="row"
        aria-hidden="true"
      >
        <span>Issue</span>
        <span>What we want</span>
        <span>Commitment</span>
        <span>Assigned to</span>
        <span>Due date</span>
        {isAdmin ? <span aria-hidden /> : null}
      </div>
      <ul className={styles.issueList}>
        {items.map((issue) => (
          <ResolvedRow
            key={issue.id}
            issue={issue}
            roster={roster}
            isAdmin={isAdmin}
          />
        ))}
      </ul>
    </div>
  );
}

function ResolvedRow({
  issue,
  roster,
  isAdmin,
}: {
  issue: IssueWithCommitments;
  roster: Array<Pick<Profile, "id" | "full_name">>;
  isAdmin: boolean;
}) {
  // Pick the newest linked commitment (any status) as the row's
  // representative — the last action taken against this issue. If
  // no commitment ever landed on the issue, the last three cells
  // render an em-dash. Nothing to interact with either way.
  const last = [...issue.commitments]
    .sort((a, b) => (a.created_at > b.created_at ? -1 : 1))[0] ?? null;
  const ownerName = last?.owner_id
    ? roster.find((p) => p.id === last.owner_id)?.full_name ?? null
    : null;

  return (
    <li className={styles.issueListItem}>
      <article
        className={
          isAdmin ? styles.resolvedRowWithDelete : styles.resolvedRow
        }
      >
        <div className={styles.cellIssue}>
          <span className={styles.issueTitle}>{issue.title}</span>
        </div>
        <div className={styles.cellWant}>
          {issue.desired_outcome ? (
            <span className={styles.wantText}>{issue.desired_outcome}</span>
          ) : (
            <span className={styles.wantMuted}>—</span>
          )}
        </div>
        <div className={styles.cellCommitment}>
          {last ? last.description : <span className={styles.cellMuted}>—</span>}
        </div>
        <div className={styles.cellOwner}>
          {ownerName ?? <span className={styles.cellMuted}>—</span>}
        </div>
        <div className={styles.cellDue}>
          {last?.due_date ? (
            last.due_date
          ) : (
            <span className={styles.cellMuted}>—</span>
          )}
        </div>
        {isAdmin ? (
          <DeleteResolvedIssueButton
            issueId={issue.id}
            issueTitle={issue.title}
          />
        ) : null}
      </article>
    </li>
  );
}

// Same trash-icon shape as DeleteIssueButton on the open row.
// Kept co-located because ResolvedIssuesList is a client component
// already and a second file for the same 40-line pattern is noise.
function DeleteResolvedIssueButton({
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
        tabIndex={0}
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
        title="Delete this resolved issue?"
        message={`This can't be undone. "${issueTitle}" will be removed from history. Any linked commitments stay live but lose their issue linkage.`}
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
