"use client";

import { useState } from "react";
import type { IssueWithCommitments } from "@/lib/issues/service";
import type { Profile } from "@/lib/types";
import styles from "./issues.module.css";

// Collapsed-by-default list of resolved issues. Read-only mirror of
// the Open issues table — same 5 content columns (Issue / What we
// want / Commitment / Assigned to / Due date) so the two sections
// read as siblings. No drag handle, no clarity pill, no Resolve
// action; nothing is click-to-edit.

export function ResolvedIssuesList({
  items,
  roster,
}: {
  items: IssueWithCommitments[];
  roster: Array<Pick<Profile, "id" | "full_name">>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className={styles.resolvedSection}>
      <button
        type="button"
        className={styles.resolvedToggle}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        Resolved issues ({items.length})
        <span aria-hidden>{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        <div className={styles.resolvedTable}>
          <div
            className={styles.resolvedColumnHeader}
            role="row"
            aria-hidden="true"
          >
            <span>Issue</span>
            <span>What we want</span>
            <span>Commitment</span>
            <span>Assigned to</span>
            <span>Due date</span>
          </div>
          <ul className={styles.issueList}>
            {items.map((issue) => (
              <ResolvedRow key={issue.id} issue={issue} roster={roster} />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function ResolvedRow({
  issue,
  roster,
}: {
  issue: IssueWithCommitments;
  roster: Array<Pick<Profile, "id" | "full_name">>;
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
      <article className={styles.resolvedRow}>
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
      </article>
    </li>
  );
}
