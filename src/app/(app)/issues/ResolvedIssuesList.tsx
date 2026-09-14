"use client";

import { useState } from "react";
import { resolvedCommitmentCell } from "@/lib/issues/resolved-row";
import type { IssueWithCommitments } from "@/lib/issues/service";
import type { Priority, Profile } from "@/lib/types";
import { CommitmentRow } from "../commitments/CommitmentRow";
import { CommitmentSubHeader } from "./IssueCard";
import { splitThread } from "@/lib/issues/thread";
import styles from "./issues.module.css";

// The Open issues list, in past tense. It shares that list's grid and
// its commitment lines rather than approximating them: same columns,
// same `CommitmentRow`, so flipping between the two sections is not
// also learning a second layout.
//
// It used to show ONE representative commitment in a cell of its own
// — the newest linked row — which meant an issue that took four goes
// showed the fourth and silently dropped the other three. The whole
// point of the thread is that an issue takes more than one attempt,
// so the history is the interesting part and it was the part being
// hidden.
//
// Admins additionally get a trash icon to hard-delete resolved issues,
// used for clearing test/junk rows out of history. The parent /issues
// page wraps this in the commitment-style .group + .groupHeader chrome
// with a count.

export function ResolvedIssuesList({
  items,
  roster,
  priorityOptions,
  todayIso,
  currentUserId,
  isAdmin,
}: {
  items: IssueWithCommitments[];
  roster: Array<Pick<Profile, "id" | "full_name">>;
  priorityOptions: Array<Pick<Priority, "id" | "title">>;
  todayIso: string;
  currentUserId: string;
  isAdmin: boolean;
}) {
  return (
    <div className={styles.resolvedTable}>
      {/* Same header as the open list, same placement classes. */}
      <div className={styles.resolvedColumnHeader} role="row" aria-hidden="true">
        <span className={styles.headIssue}>Issue</span>
        <span className={styles.headWant}>What we want</span>
      </div>
      <ul className={styles.issueList}>
        {items.map((issue) => (
          <ResolvedRow
            key={issue.id}
            issue={issue}
            roster={roster}
            priorityOptions={priorityOptions}
            todayIso={todayIso}
            currentUserId={currentUserId}
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
  priorityOptions,
  todayIso,
  currentUserId,
  isAdmin,
}: {
  issue: IssueWithCommitments;
  roster: Array<Pick<Profile, "id" | "full_name">>;
  priorityOptions: Array<Pick<Priority, "id" | "title">>;
  todayIso: string;
  currentUserId: string;
  isAdmin: boolean;
}) {
  // Same ordering the open card uses when its history is expanded:
  // finished first, then anything still live. A resolved issue CAN
  // carry open commitments — six did at the time the thread model
  // landed, and they are grandfathered, not reinterpreted.
  const thread = splitThread(issue.commitments);
  const lines = [
    ...thread.completed,
    ...(thread.active ? [thread.active] : []),
    ...thread.otherOpen,
  ];

  // Rule lives in lib/issues/resolved-row.ts so it can be tested —
  // there's no DOM test tooling in this project. It answers what to
  // show when NO commitment carries text: the meeting-summary
  // shortcut closes an issue without ever creating one, and a bare
  // em-dash there reads as missing data rather than as a fact.
  const anyText = issue.commitments
    .map((c) => c.description)
    .find((d) => d?.trim());
  const commitmentCell = resolvedCommitmentCell({
    commitmentDescription: anyText,
    resolvedInMeeting: issue.resolved_in_meeting,
  });

  const canEditCommitment = (ownerId: string | null): boolean =>
    isAdmin || (ownerId !== null && ownerId === currentUserId);

  // COLLAPSED BY DEFAULT. A resolved issue's commitments are the
  // record of how it got solved, which is worth keeping and worth
  // reading occasionally — not worth rendering in full for every
  // issue in the archive. Expanded, the list was several stacked
  // blocks of equal weight with no way to tell where one issue ended
  // and the next began.
  const [expanded, setExpanded] = useState(false);
  const hasThread = commitmentCell.kind === "commitment";

  return (
    <li className={styles.issueListItem}>
      <article className={styles.resolvedRow}>
        {/* DOM ORDER IS COLUMN ORDER. Every cell here is placed at
            an explicit grid-column, and auto-flow only moves
            forward: an item whose column sits behind the cursor
            starts a NEW ROW and drags everything after it along.
            Emitted check-delete-placeholder, that is what put this
            list's title and outcome on a second line. */}
        {/* No drag handle: resolved issues carry no ordering. The
            placeholder keeps the column, so the two lists line up. */}
        <span aria-hidden className={styles.dragHandlePlaceholder} />

        {/* A kept commitment shows a filled check; so does a
            resolved issue. Static, not a button — there is no
            reopen, so an affordance here would promise one. */}
        <span aria-hidden className={styles.issueResolvedMark}>✓</span>

        {/* No delete here. An issue is deletable while it is OPEN
            and becomes a record once it is resolved: the commitments
            under it are already counted in follow-through and the
            weekly scorecard, so removing the issue leaves the
            arithmetic standing with nothing to explain it. The
            placeholder holds the column so both lists still line
            up. */}
        <span aria-hidden className={styles.deletePlaceholder} />

        {/* The disclosure. A CHEVRON, not a plus: on this page a
            filled circle holding a plus is the Add control on the
            commitment line, and giving the same glyph a second
            meaning two rows away is how the first one stopped being
            readable. Column 4, immediately left of what it opens. */}
        {hasThread ? (
          <button
            type="button"
            className={styles.threadDisclosure}
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={`${expanded ? "Hide" : "Show"} ${lines.length} commitment${
              lines.length === 1 ? "" : "s"
            } on "${issue.title}"`}
            title={`${expanded ? "Hide" : "Show"} ${lines.length} commitment${
              lines.length === 1 ? "" : "s"
            }`}
          >
            <span aria-hidden>{expanded ? "▾" : "▸"}</span>
          </button>
        ) : (
          <span aria-hidden className={styles.threadDisclosurePlaceholder} />
        )}

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

        {expanded || !hasThread ? (
        <div className={styles.commitments}>
          {commitmentCell.kind === "commitment" ? (
            <>
              <CommitmentSubHeader />
              <ul className={styles.commitmentList}>
                {lines.map((c) => (
                  <CommitmentRow
                    key={c.id}
                    commitment={c}
                    priorityOptions={priorityOptions}
                    roster={roster}
                    todayIso={todayIso}
                    canResolve={canEditCommitment(c.owner_id)}
                    canReassign={canEditCommitment(c.owner_id)}
                    canLink={false}
                    hidePriority
                    currentUserId={currentUserId}
                    isAdmin={isAdmin}
                  />
                ))}
              </ul>
            </>
          ) : commitmentCell.kind === "in-meeting" ? (
            <p className={styles.resolvedNote}>
              <span className={styles.cellResolvedInMeeting}>
                Resolved in meeting
              </span>{" "}
              — the team talked it through and closed it without
              raising a commitment.
            </p>
          ) : (
            <p className={styles.resolvedNote}>
              No commitment was ever raised on this issue.
            </p>
          )}
        </div>
        ) : null}
      </article>
    </li>
  );
}
