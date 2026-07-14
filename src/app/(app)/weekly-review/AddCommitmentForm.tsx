"use client";

import { useActionState, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  createCommitmentAction,
  type CommitmentResult,
} from "@/lib/commitments/actions";
import type { Priority, Profile } from "@/lib/types";
import { useStayOpenForm } from "@/lib/hooks/use-stay-open-form";
import { ConfirmationChip } from "@/components/ui/ConfirmationChip";
import styles from "./weekly-review.module.css";

const INITIAL: CommitmentResult = { ok: false, message: "" };

// The composer for "Add a commitment" — Section 8.4 This Week.
// The priority picker is a typeahead built on <datalist> so users can
// start typing to filter the list. On submit we resolve the typed
// title back to a priority id via a hidden input.

export function AddCommitmentForm({
  weekEnding,
  priorityOptions,
  roster,
  currentUserId,
  isAdmin,
}: {
  weekEnding: string;
  priorityOptions: Array<Pick<Priority, "id" | "title">>;
  roster: Array<Pick<Profile, "id" | "full_name">>;
  currentUserId: string;
  isAdmin: boolean;
}) {
  const [state, formAction, pending] = useActionState<
    CommitmentResult,
    FormData
  >(createCommitmentAction, INITIAL);
  const errorMessage =
    state && "ok" in state && !state.ok && state.message ? state.message : null;
  const { formRef, confirmationVisible } = useStayOpenForm(
    state,
    pending,
    (s) => Boolean(s && "ok" in s && s.ok)
  );

  const datalistId = useId();
  const [priorityQuery, setPriorityQuery] = useState("");

  // Also reset the controlled priority-picker state after a successful submit
  // so the user can immediately type the next one.
  const lastSuccessRef = useRef(false);
  useEffect(() => {
    const succeeded = Boolean(state && "ok" in state && state.ok);
    if (succeeded && !lastSuccessRef.current) {
      setPriorityQuery("");
    }
    lastSuccessRef.current = succeeded;
  }, [state]);

  // Resolve the typed title (or the user picking from the datalist) back
  // to the priority's id. Case-insensitive exact match.
  const resolvedPriorityId = useMemo(() => {
    const trimmed = priorityQuery.trim().toLowerCase();
    if (!trimmed) return "";
    return (
      priorityOptions.find((option) => option.title.toLowerCase() === trimmed)
        ?.id ?? ""
    );
  }, [priorityQuery, priorityOptions]);
  const priorityInvalid = priorityQuery.trim().length > 0 && !resolvedPriorityId;

  return (
    <form action={formAction} className={styles.composerForm} ref={formRef}>
      <input type="hidden" name="week_ending" value={weekEnding} />

      <div className={styles.fieldWide}>
        <label htmlFor="commitment-description" className={styles.label}>
          What will you do?
        </label>
        <input
          id="commitment-description"
          name="description"
          required
          className={styles.input}
          placeholder="A specific, verifiable step toward a priority."
          disabled={pending}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="commitment-priority" className={styles.label}>
          Priority
        </label>
        <input
          id="commitment-priority"
          type="text"
          list={datalistId}
          value={priorityQuery}
          onChange={(event) => setPriorityQuery(event.target.value)}
          required
          className={styles.input}
          placeholder="Type to search priorities…"
          autoComplete="off"
          disabled={pending}
          aria-invalid={priorityInvalid || undefined}
        />
        <datalist id={datalistId}>
          {priorityOptions.map((option) => (
            <option key={option.id} value={option.title} />
          ))}
        </datalist>
        <input
          type="hidden"
          name="priority_id"
          value={resolvedPriorityId}
        />
        {priorityInvalid ? (
          <p className={styles.fieldHint}>
            Pick one from the list — that title isn&rsquo;t a priority yet.
          </p>
        ) : null}
      </div>

      <div className={styles.field}>
        <label htmlFor="commitment-owner" className={styles.label}>
          Owner
        </label>
        {isAdmin ? (
          <select
            id="commitment-owner"
            name="owner_id"
            defaultValue={currentUserId}
            className={styles.select}
            disabled={pending}
          >
            {roster.map((person) => (
              <option key={person.id} value={person.id}>
                {person.full_name}
              </option>
            ))}
          </select>
        ) : (
          <>
            <input type="hidden" name="owner_id" value={currentUserId} />
            <div className={styles.readOnlyValue}>
              {roster.find((p) => p.id === currentUserId)?.full_name ?? "You"}
            </div>
          </>
        )}
      </div>

      <div className={styles.field}>
        <label htmlFor="commitment-due" className={styles.label}>
          Due
        </label>
        <input
          id="commitment-due"
          name="due_date"
          type="date"
          defaultValue={weekEnding}
          className={styles.input}
          disabled={pending}
        />
      </div>

      {errorMessage ? (
        <p role="alert" className={styles.errorMessage}>
          {errorMessage}
        </p>
      ) : null}

      <div className={styles.submitRow}>
        <button
          type="submit"
          className={styles.primaryButton}
          disabled={pending || !resolvedPriorityId}
        >
          {pending ? "Adding…" : "Add commitment"}
        </button>
        <ConfirmationChip visible={confirmationVisible} />
      </div>
    </form>
  );
}
