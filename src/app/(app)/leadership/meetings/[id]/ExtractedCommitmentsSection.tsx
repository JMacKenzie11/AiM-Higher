"use client";

import { useState, useTransition } from "react";
import {
  addExtractedCommitmentAction,
  convertExtractedCommitmentToIssueAction,
} from "@/lib/transcripts/routing-actions";
import type { ExtractedCommitment, Priority } from "@/lib/types";
import type { SimilarMatch } from "@/lib/transcripts/similarity";
import uiStyles from "@/components/ui/ui.module.css";
import styles from "./extracted.module.css";
import { SimilarMatchBadge } from "./SimilarMatchBadge";
import { DoneChip } from "./DoneChip";

// "Commitments identified" section on the meeting summary when
// the company has automatic_commitment_tracking OFF. Each row
// shows the extracted commitment + owner + due + a three-option
// Add action row (Add to priority / Add to functional area /
// Convert to issue). Rows already promoted show a done state.
// Duplicate-awareness badge behaves the same as on the issues
// section.
//
// When auto-tracking is ON, the analyze pipeline already created
// the commitments; the parent page renders those from the
// commitments table itself, not this section.

// Done-state shape. When a commitment landed we also carry the
// link target so the done label can read "Added to <Priority>"
// or "Added to <Function>" instead of a generic "Captured".
export type ExtractedCommitmentAddedAs =
  | {
      kind: "commitment";
      link:
        | { kind: "priority"; title: string }
        | { kind: "functional_area"; title: string }
        | { kind: "none" };
    }
  | { kind: "issue" }
  | null;

export type ExtractedCommitmentRow = {
  commitment: ExtractedCommitment;
  ownerName: string | null;
  addedAs: ExtractedCommitmentAddedAs;
  similar: SimilarMatch | null;
};

// Human label for the done chip. "Added to <name>" whenever we
// know the link target; falls back to a generic "Captured as
// commitment" when the caller picked no link at all, and "Issue
// created" when convert-to-issue was clicked.
function doneLabelFor(addedAs: NonNullable<ExtractedCommitmentAddedAs>): string {
  if (addedAs.kind === "issue") return "Issue created";
  if (addedAs.link.kind === "priority") {
    return `Added to ${addedAs.link.title}`;
  }
  if (addedAs.link.kind === "functional_area") {
    return `Added to ${addedAs.link.title}`;
  }
  return "Captured as commitment";
}

export function ExtractedCommitmentsSection({
  meetingId,
  rows,
  priorityOptions,
  functionalAreaOptions,
  canAdd,
}: {
  meetingId: string;
  rows: ExtractedCommitmentRow[];
  priorityOptions: Array<Pick<Priority, "id" | "title">>;
  functionalAreaOptions: Array<{ id: string; title: string }>;
  canAdd: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <section className={styles.section} aria-labelledby="commitments-extracted">
      <h2 id="commitments-extracted" className={styles.sectionTitle}>
        Commitments identified
      </h2>
      <p className={styles.sectionHint}>
        Extracted from the transcript. Automatic commitment
        tracking is off for this company, so nothing lands on the
        commitments board until you add it here.
      </p>
      <ul className={styles.rowList}>
        {rows.map((r, i) => (
          <ExtractedCommitmentRowItem
            key={`${i}-${r.commitment.description}`}
            meetingId={meetingId}
            row={r}
            priorityOptions={priorityOptions}
            functionalAreaOptions={functionalAreaOptions}
            canAdd={canAdd}
          />
        ))}
      </ul>
    </section>
  );
}

function ExtractedCommitmentRowItem({
  meetingId,
  row,
  priorityOptions,
  functionalAreaOptions,
  canAdd,
}: {
  meetingId: string;
  row: ExtractedCommitmentRow;
  priorityOptions: Array<Pick<Priority, "id" | "title">>;
  functionalAreaOptions: Array<{ id: string; title: string }>;
  canAdd: boolean;
}) {
  const [addedAs, setAddedAs] = useState<ExtractedCommitmentAddedAs>(
    row.addedAs
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function addWith(
    target:
      | { type: "priority"; id: string; title: string }
      | { type: "functional_area"; id: string; title: string }
      | { type: "none" }
  ) {
    setError(null);
    startTransition(async () => {
      const result = await addExtractedCommitmentAction({
        meetingId,
        description: row.commitment.description,
        dueDate: row.commitment.due_date ?? null,
        ownerId: row.commitment.owner_profile_id ?? null,
        target:
          target.type === "priority"
            ? { type: "priority", id: target.id }
            : target.type === "functional_area"
              ? { type: "functional_area", id: target.id }
              : { type: "none" },
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      // Optimistic done-state that mirrors what the server just
      // wrote — same shape as row.addedAs so a hard refresh would
      // read the identical thing.
      if (target.type === "priority") {
        setAddedAs({
          kind: "commitment",
          link: { kind: "priority", title: target.title },
        });
      } else if (target.type === "functional_area") {
        setAddedAs({
          kind: "commitment",
          link: { kind: "functional_area", title: target.title },
        });
      } else {
        setAddedAs({ kind: "commitment", link: { kind: "none" } });
      }
    });
  }

  function convertToIssue() {
    setError(null);
    startTransition(async () => {
      const result = await convertExtractedCommitmentToIssueAction(
        meetingId,
        row.commitment.description
      );
      if (!result.ok) setError(result.message);
      else setAddedAs({ kind: "issue" });
    });
  }

  return (
    <li className={styles.row}>
      <div className={styles.rowMain}>
        <p className={styles.rowText}>{row.commitment.description}</p>
        <p className={styles.rowMeta}>
          {row.ownerName ?? "Unassigned"}
          {row.commitment.due_date ? ` · Due ${row.commitment.due_date}` : ""}
        </p>
        {row.similar ? <SimilarMatchBadge match={row.similar} /> : null}
        {error ? (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        ) : null}
      </div>
      <div className={styles.rowActions}>
        {addedAs ? (
          <DoneChip
            label={doneLabelFor(addedAs)}
            aria-live="polite"
          />
        ) : canAdd ? (
          <>
            <select
              className={styles.picker}
              defaultValue=""
              disabled={pending || priorityOptions.length === 0}
              aria-label="Link to a priority"
              onChange={(e) => {
                const id = e.target.value;
                if (id) {
                  const p = priorityOptions.find((x) => x.id === id);
                  addWith({
                    type: "priority",
                    id,
                    title: p?.title ?? "priority",
                  });
                }
                e.currentTarget.value = "";
              }}
            >
              <option value="">
                {priorityOptions.length === 0
                  ? "No open priorities"
                  : "Link to priority…"}
              </option>
              {priorityOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
            <select
              className={styles.picker}
              defaultValue=""
              disabled={pending || functionalAreaOptions.length === 0}
              aria-label="Link to a functional area"
              onChange={(e) => {
                const id = e.target.value;
                if (id) {
                  const f = functionalAreaOptions.find((x) => x.id === id);
                  addWith({
                    type: "functional_area",
                    id,
                    title: f?.title ?? "functional area",
                  });
                }
                e.currentTarget.value = "";
              }}
            >
              <option value="">
                {functionalAreaOptions.length === 0
                  ? "No functional areas"
                  : "Link to functional area…"}
              </option>
              {functionalAreaOptions.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.title}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={`${uiStyles.btnGhost} ${uiStyles.btnSm}`}
              onClick={convertToIssue}
              disabled={pending}
              title="Create an issue titled from this description; does not create a commitment"
            >
              Convert to issue
            </button>
          </>
        ) : (
          <span className={styles.doneMuted}>Admin action</span>
        )}
      </div>
    </li>
  );
}
