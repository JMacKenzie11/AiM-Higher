"use client";

import { useState, useTransition } from "react";
import {
  addExtractedIssueAsResolvedAction,
  addExtractedIssueToOpenIssuesAction,
} from "@/lib/transcripts/routing-actions";
import type { ExtractedIssue } from "@/lib/types";
import type { SimilarMatch } from "@/lib/transcripts/similarity";
import uiStyles from "@/components/ui/ui.module.css";
import styles from "./extracted.module.css";
import { SimilarMatchBadge } from "./SimilarMatchBadge";
import { DoneChip } from "./DoneChip";

// "Issues identified" section on the meeting summary. Every
// extracted issue renders as a row with an Add-to-open-issues
// button. If the row was already added (matched by title +
// source_meeting_id), the button flips to a disabled done state.
// A muted "Possibly already captured" badge appears when the
// similarity check finds a near-duplicate open item.

export type ExtractedIssueRow = {
  issue: ExtractedIssue;
  alreadyAdded: boolean;
  // When alreadyAdded is true, remembers which path created the
  // row so the chip label survives a page refresh — "Resolved in
  // meeting" for the closed shortcut, "Added as issue" for the
  // open path. Null when alreadyAdded is false.
  alreadyAddedAs: "open" | "resolved" | null;
  similar: SimilarMatch | null;
};

export function ExtractedIssuesSection({
  meetingId,
  rows,
  canAdd,
}: {
  meetingId: string;
  rows: ExtractedIssueRow[];
  canAdd: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <section className={styles.section} aria-labelledby="issues-identified">
      <h2 id="issues-identified" className={styles.sectionTitle}>
        Issues identified
      </h2>
      <p className={styles.sectionHint}>
        Unresolved questions the team raised. Add the ones worth
        working on to the open issues list.
      </p>
      <ul className={styles.rowList}>
        {rows.map((r, i) => (
          <ExtractedIssueRowItem
            key={`${i}-${r.issue.title}`}
            meetingId={meetingId}
            row={r}
            canAdd={canAdd}
          />
        ))}
      </ul>
    </section>
  );
}

function ExtractedIssueRowItem({
  meetingId,
  row,
  canAdd,
}: {
  meetingId: string;
  row: ExtractedIssueRow;
  canAdd: boolean;
}) {
  const [added, setAdded] = useState(row.alreadyAdded);
  const [pending, startTransition] = useTransition();
  // Track which action fired so the correct done-state label shows
  // after a click. Seed from row.alreadyAddedAs so a page refresh
  // keeps the "Resolved in meeting" label rather than falling back
  // to the generic "Added as issue".
  const [addedAs, setAddedAs] = useState<"open" | "resolved" | null>(
    row.alreadyAddedAs
  );
  const [error, setError] = useState<string | null>(null);

  function addAsOpen() {
    setError(null);
    startTransition(async () => {
      const result = await addExtractedIssueToOpenIssuesAction(
        meetingId,
        row.issue.title
      );
      if (!result.ok) setError(result.message);
      else {
        setAdded(true);
        setAddedAs("open");
      }
    });
  }

  function addAsResolved() {
    setError(null);
    startTransition(async () => {
      const result = await addExtractedIssueAsResolvedAction(
        meetingId,
        row.issue.title
      );
      if (!result.ok) setError(result.message);
      else {
        setAdded(true);
        setAddedAs("resolved");
      }
    });
  }

  return (
    <li className={styles.row}>
      <div className={styles.rowMain}>
        <p className={styles.rowText}>{row.issue.title}</p>
        {row.similar ? <SimilarMatchBadge match={row.similar} /> : null}
        {error ? (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        ) : null}
      </div>
      <div className={styles.rowActions}>
        {added ? (
          <DoneChip
            label={
              addedAs === "resolved"
                ? "Resolved in meeting"
                : "Added as issue"
            }
          />
        ) : canAdd ? (
          <>
            {/* Order matches the spec: "Resolved in Meeting" on the
                left, "Add to open issues" on the right. Both use
                the primary brand button so the row reads with the
                rest of the app's button vocabulary. */}
            <button
              type="button"
              className={`${uiStyles.btnPrimary} ${uiStyles.btnSm}`}
              onClick={addAsResolved}
              disabled={pending}
              title="Add to the resolved list right away — no follow-up work needed."
            >
              {pending ? "…" : "Resolved in meeting"}
            </button>
            <button
              type="button"
              className={`${uiStyles.btnPrimary} ${uiStyles.btnSm}`}
              onClick={addAsOpen}
              disabled={pending}
            >
              {pending ? "…" : "Add to open issues"}
            </button>
          </>
        ) : (
          <span className={styles.doneMuted}>Admin action</span>
        )}
      </div>
    </li>
  );
}
