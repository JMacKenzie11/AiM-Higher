"use client";

import { useState, useTransition } from "react";
import { addExtractedIssueToOpenIssuesAction } from "@/lib/transcripts/routing-actions";
import type { ExtractedIssue } from "@/lib/types";
import type { SimilarMatch } from "@/lib/transcripts/similarity";
import uiStyles from "@/components/ui/ui.module.css";
import styles from "./extracted.module.css";

// "Issues identified" section on the meeting summary. Every
// extracted issue renders as a row with an Add-to-open-issues
// button. If the row was already added (matched by title +
// source_meeting_id), the button flips to a disabled done state.
// A muted "Possibly already captured" badge appears when the
// similarity check finds a near-duplicate open item.

export type ExtractedIssueRow = {
  issue: ExtractedIssue;
  alreadyAdded: boolean;
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
  const [error, setError] = useState<string | null>(null);

  function add() {
    setError(null);
    startTransition(async () => {
      const result = await addExtractedIssueToOpenIssuesAction(
        meetingId,
        row.issue.title
      );
      if (!result.ok) setError(result.message);
      else setAdded(true);
    });
  }

  return (
    <li className={styles.row}>
      <div className={styles.rowMain}>
        <p className={styles.rowText}>{row.issue.title}</p>
        {row.similar ? (
          <span
            className={styles.badge}
            title={`Similar to: “${row.similar.text}”`}
          >
            Possibly already captured
          </span>
        ) : null}
        {error ? (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        ) : null}
      </div>
      <div className={styles.rowActions}>
        {added ? (
          <span className={styles.done} aria-live="polite">
            Added
          </span>
        ) : canAdd ? (
          <button
            type="button"
            className={`${uiStyles.btnGhost} ${uiStyles.btnSm}`}
            onClick={add}
            disabled={pending}
          >
            {pending ? "Adding…" : "Add to open issues"}
          </button>
        ) : (
          <span className={styles.doneMuted}>Admin action</span>
        )}
      </div>
    </li>
  );
}
