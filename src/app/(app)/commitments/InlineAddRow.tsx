"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  createCommitmentAction,
  type CommitmentResult,
} from "@/lib/commitments/actions";
import type { Priority, Profile } from "@/lib/types";
import { LinkPicker } from "./LinkPicker";
import styles from "./commitments.module.css";

// Always-live entry row. Sits at the bottom of "This week"; the row
// is the affordance — no "Add" button opens a form. Save it, focus
// jumps to the next blank ready for the next commitment.

const INITIAL: CommitmentResult = { ok: false, message: "" };

export type InlineAddRowProps = {
  thisFriday: string;
  priorityOptions: Array<Pick<Priority, "id" | "title">>;
  // Functional area options fill the second half of the composer's
  // link picker. Optional — legacy callers that haven't wired the
  // chart's functions in yet get a priority-only picker (no
  // functional area group renders).
  functionalAreaOptions?: Array<{ id: string; title: string }>;
  roster: Array<Pick<Profile, "id" | "full_name">>;
  currentUserId: string;
  isAdmin: boolean;
  quarterCoversThisWeek: boolean;
  noQuarterMessage: string;
  // On a priority detail page the priority is implicit — pass the
  // id here to pin it and hide the picker. Reset keeps the pinned
  // id after save so the row stays scoped to this priority.
  fixedPriorityId?: string | null;
};

export function InlineAddRow({
  thisFriday,
  priorityOptions,
  functionalAreaOptions = [],
  roster,
  currentUserId,
  isAdmin,
  quarterCoversThisWeek,
  noQuarterMessage,
  fixedPriorityId,
}: InlineAddRowProps) {
  const pinnedPriority = fixedPriorityId ?? null;
  const [priorityId, setPriorityId] = useState<string | null>(pinnedPriority);
  const [functionalAreaId, setFunctionalAreaId] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState<string>(currentUserId);
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState(thisFriday);
  // Ongoing (weekly): resolving rolls the due_date forward 7 days
  // and records the resolution as a per-week occurrence. Toggled
  // alongside the date picker so a user can choose "one-shot Friday
  // date" vs "repeat every week" with one click.
  const [isOngoing, setIsOngoing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, formAction, pending] = useActionState<
    CommitmentResult,
    FormData
  >(createCommitmentAction, INITIAL);

  function resetToBlank() {
    setDescription("");
    setPriorityId(pinnedPriority);
    setFunctionalAreaId(null);
    setDueDate(thisFriday);
    setOwnerId(currentUserId);
    setIsOngoing(false);
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

  const formClasses = [styles.addForm];
  if (pinnedPriority) formClasses.push(styles.addFormNoPriority);

  return (
    <div className={`${styles.inlineAddRow} ${styles.inlineAddRowDraft}`}>
      <form action={formAction} className={formClasses.join(" ")}>
        <input type="hidden" name="week_ending" value={thisFriday} />
        <input type="hidden" name="priority_id" value={priorityId ?? ""} />
        <input
          type="hidden"
          name="functional_area_id"
          value={functionalAreaId ?? ""}
        />
        <input type="hidden" name="owner_id" value={ownerId} />
        <input
          type="hidden"
          name="is_ongoing"
          value={isOngoing ? "true" : "false"}
        />

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

        {pinnedPriority ? null : (
          <LinkPicker
            priorityOptions={priorityOptions}
            functionalAreaOptions={functionalAreaOptions}
            value={{ priorityId, functionalAreaId }}
            onSelect={(v) => {
              setPriorityId(v.priorityId);
              setFunctionalAreaId(v.functionalAreaId);
            }}
            disabled={pending}
          />
        )}

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
          disabled={pending || isOngoing}
          aria-label="Due date"
        />

        <label
          className={styles.addField}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.35rem",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
          title="Repeats every week — resolving rolls the due date forward"
        >
          <input
            type="checkbox"
            checked={isOngoing}
            onChange={(e) => setIsOngoing(e.target.checked)}
            disabled={pending}
          />
          Ongoing (weekly)
        </label>

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
