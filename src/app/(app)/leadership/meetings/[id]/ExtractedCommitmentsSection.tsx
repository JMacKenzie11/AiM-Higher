"use client";

import { useState, useTransition } from "react";
import {
  addExtractedCommitmentAction,
  convertExtractedCommitmentToIssueAction,
} from "@/lib/transcripts/routing-actions";
import type { ExtractedCommitment, Priority } from "@/lib/types";
import type { SimilarMatch } from "@/lib/transcripts/similarity";
import styles from "./extracted.module.css";

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

export type ExtractedCommitmentRow = {
  commitment: ExtractedCommitment;
  ownerName: string | null;
  alreadyAdded: boolean;
  similar: SimilarMatch | null;
};

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
  const [added, setAdded] = useState(row.alreadyAdded);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function addWith(
    target:
      | { type: "priority"; id: string }
      | { type: "functional_area"; id: string }
      | { type: "none" }
  ) {
    setError(null);
    startTransition(async () => {
      const result = await addExtractedCommitmentAction({
        meetingId,
        description: row.commitment.description,
        dueDate: row.commitment.due_date ?? null,
        ownerId: row.commitment.owner_profile_id ?? null,
        target,
      });
      if (!result.ok) setError(result.message);
      else setAdded(true);
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
      else setAdded(true);
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
          <>
            <label className={styles.pickerLabel}>
              <span className={styles.pickerLabelText}>Add to priority</span>
              <select
                className={styles.picker}
                defaultValue=""
                disabled={pending || priorityOptions.length === 0}
                onChange={(e) => {
                  const id = e.target.value;
                  if (id) addWith({ type: "priority", id });
                  e.currentTarget.value = "";
                }}
              >
                <option value="">
                  {priorityOptions.length === 0 ? "No open priorities" : "…pick"}
                </option>
                {priorityOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.pickerLabel}>
              <span className={styles.pickerLabelText}>
                Add to functional area
              </span>
              <select
                className={styles.picker}
                defaultValue=""
                disabled={pending || functionalAreaOptions.length === 0}
                onChange={(e) => {
                  const id = e.target.value;
                  if (id) addWith({ type: "functional_area", id });
                  e.currentTarget.value = "";
                }}
              >
                <option value="">
                  {functionalAreaOptions.length === 0
                    ? "No functional areas"
                    : "…pick"}
                </option>
                {functionalAreaOptions.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.title}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={styles.actionButton}
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
