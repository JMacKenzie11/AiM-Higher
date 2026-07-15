"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  createCommitmentAction,
  type CommitmentResult,
} from "@/lib/commitments/actions";
import type { Priority, Profile } from "@/lib/types";
import { PriorityPicker } from "./PriorityPicker";
import styles from "./commitments.module.css";

// Inline add row lives at the bottom of the "This week" group.
// Click the muted placeholder to expand into a form. On save, the form
// resets to a fresh blank ready for the next commitment (Section 4.4
// rhythm — capture-in-motion, not modal-in-the-way).

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
  const [expanded, setExpanded] = useState(false);
  const [priorityId, setPriorityId] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState<string>(currentUserId);
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState(thisFriday);
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, formAction, pending] = useActionState<
    CommitmentResult,
    FormData
  >(createCommitmentAction, INITIAL);

  // On save success: clear the form, keep it expanded so the user can
  // capture the next one immediately (that's the whole point).
  useEffect(() => {
    if (state && "ok" in state && state.ok) {
      setDescription("");
      setPriorityId(null);
      setDueDate(thisFriday);
      setOwnerId(currentUserId);
      inputRef.current?.focus();
    }
  }, [state, thisFriday, currentUserId]);

  const errorMessage =
    state && "ok" in state && !state.ok && state.message ? state.message : null;

  if (!quarterCoversThisWeek) {
    return (
      <div className={styles.inlineAddRow}>
        <p className={styles.addDisabled}>{noQuarterMessage}</p>
      </div>
    );
  }

  if (!expanded) {
    return (
      <div className={styles.inlineAddRow}>
        <button
          type="button"
          className={styles.inlinePlaceholder}
          onClick={() => {
            setExpanded(true);
            setTimeout(() => inputRef.current?.focus(), 0);
          }}
        >
          + Add a commitment…
        </button>
      </div>
    );
  }

  return (
    <div className={styles.inlineAddRow}>
      <form action={formAction} className={styles.addForm}>
        <input type="hidden" name="week_ending" value={thisFriday} />
        <input type="hidden" name="priority_id" value={priorityId ?? ""} />
        <input type="hidden" name="owner_id" value={ownerId} />

        <input
          ref={inputRef}
          type="text"
          name="description"
          className={styles.addField}
          placeholder="A specific, verifiable step."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
          disabled={pending}
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
