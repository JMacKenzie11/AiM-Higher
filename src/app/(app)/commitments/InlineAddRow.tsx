"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  createCommitmentAction,
  type CommitmentResult,
} from "@/lib/commitments/actions";
import type { Priority, Profile } from "@/lib/types";
import { PriorityPicker } from "./PriorityPicker";
import styles from "./commitments.module.css";

// Always-live entry row. Sits at the bottom of "This week"; the row
// is the affordance — no "Add" button opens a form. Save it, focus
// jumps to the next blank ready for the next commitment.

const INITIAL: CommitmentResult = { ok: false, message: "" };

export type InlineAddRowProps = {
  thisFriday: string;
  priorityOptions: Array<Pick<Priority, "id" | "title">>;
  roster: Array<Pick<Profile, "id" | "full_name">>;
  currentUserId: string;
  isAdmin: boolean;
  quarterCoversThisWeek: boolean;
  noQuarterMessage: string;
};

export function InlineAddRow({
  thisFriday,
  priorityOptions,
  roster,
  currentUserId,
  isAdmin,
  quarterCoversThisWeek,
  noQuarterMessage,
}: InlineAddRowProps) {
  const [priorityId, setPriorityId] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState<string>(currentUserId);
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState(thisFriday);
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, formAction, pending] = useActionState<
    CommitmentResult,
    FormData
  >(createCommitmentAction, INITIAL);

  function resetToBlank() {
    setDescription("");
    setPriorityId(null);
    setDueDate(thisFriday);
    setOwnerId(currentUserId);
    inputRef.current?.focus();
  }

  // On save success: clear the form, jump focus to the description
  // field so momentum stays. That's the whole point of the live row.
  useEffect(() => {
    if (state && "ok" in state && state.ok) {
      resetToBlank();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const errorMessage =
    state && "ok" in state && !state.ok && state.message ? state.message : null;

  if (!quarterCoversThisWeek) {
    return (
      <div className={styles.inlineAddRow}>
        <p className={styles.addDisabled}>{noQuarterMessage}</p>
      </div>
    );
  }

  return (
    <div className={`${styles.inlineAddRow} ${styles.inlineAddRowDraft}`}>
      <form action={formAction} className={styles.addForm}>
        <input type="hidden" name="week_ending" value={thisFriday} />
        <input type="hidden" name="priority_id" value={priorityId ?? ""} />
        <input type="hidden" name="owner_id" value={ownerId} />

        <input
          ref={inputRef}
          type="text"
          name="description"
          className={styles.addField}
          placeholder="Add a commitment — a specific, verifiable step."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => {
            // Escape clears the draft without submitting. Enter submits
            // the form (default form behavior) as long as the required
            // description is present.
            if (e.key === "Escape") {
              e.preventDefault();
              resetToBlank();
            }
          }}
          required
          disabled={pending}
          aria-label="New commitment"
        />

        <PriorityPicker
          priorityOptions={priorityOptions}
          currentPriorityId={priorityId}
          onSelect={setPriorityId}
          disabled={pending}
        />

        {isAdmin ? (
          <select
            className={styles.addField}
            value={ownerId}
            onChange={(e) => setOwnerId(e.target.value)}
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
          <span className={styles.addField} aria-label="Owner (you)">
            {roster.find((p) => p.id === currentUserId)?.full_name ?? "You"}
          </span>
        )}

        <input
          type="date"
          name="due_date"
          className={styles.addField}
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          disabled={pending}
          aria-label="Due date"
        />

        <button
          type="submit"
          className={styles.addSubmit}
          disabled={pending || !description.trim()}
        >
          {pending ? "Saving…" : "Add"}
        </button>

        {errorMessage ? (
          <p role="alert" className={styles.addError}>
            {errorMessage}
          </p>
        ) : null}
      </form>
    </div>
  );
}
