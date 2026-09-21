"use client";

import { useActionState, useId } from "react";
import {
  createCommitmentAction,
  type CommitmentResult,
} from "@/lib/commitments/actions";
import type { Profile } from "@/lib/types";
import { useStayOpenForm } from "@/lib/hooks/use-stay-open-form";
import { ConfirmationChip } from "@/components/ui/ConfirmationChip";
import styles from "./plan.module.css";

const INITIAL: CommitmentResult = { ok: false, message: "" };

export type PriorityChoice = {
  id: string;
  title: string;
  // What the priority sits under, for the picker's optgroup. The
  // cascade can hold two priorities with the same title under
  // different parents, and "Sign the lease" twice in a row is not a
  // choice anybody can make.
  parentLabel: string;
};

// Add a commitment from /plan, against a quarterly priority.
//
// The priority is REQUIRED here, unlike the composer on
// /commitments. This panel sits in the plan toolbar, where the
// question being answered is "what moves this quarter's plan
// forward"; an unlinked commitment is a real thing, and the place to
// create one is the board that shows unlinked work.
export function AddCommitmentForm({
  priorities,
  people,
  defaultOwnerId,
  defaultDueDate,
  onAdded,
}: {
  priorities: PriorityChoice[];
  people: Pick<Profile, "id" | "full_name">[];
  defaultOwnerId: string | null;
  // This Friday in the company's timezone, computed on the server so
  // the date does not depend on where the reader's laptop thinks it
  // is.
  defaultDueDate: string;
  // Called after a successful create, once router.refresh()
  // has been requested. The plan toolbar's Drawer closes on it.
  onAdded?: () => void;
}) {
  const [state, formAction, pending] = useActionState<
    CommitmentResult,
    FormData
  >(createCommitmentAction, INITIAL);

  // Scoped per instance: see the same note in AddPriorityForm.
  const uid = useId();
  const fieldId = (name: string) => `${name}-${uid}`;
  const errorMessage =
    state && "ok" in state && !state.ok && state.message ? state.message : null;
  const { formRef, confirmationVisible } = useStayOpenForm(
    state,
    pending,
    (s) => Boolean(s && "ok" in s && s.ok),
    { closeAncestor: "details", onSuccess: onAdded }
  );

  // Group by parent so the list reads as the cascade does.
  const groups = priorities.reduce<Map<string, PriorityChoice[]>>(
    (acc, choice) => {
      const list = acc.get(choice.parentLabel);
      if (list) list.push(choice);
      else acc.set(choice.parentLabel, [choice]);
      return acc;
    },
    new Map()
  );

  return (
    <form action={formAction} className={styles.form} ref={formRef}>
      <div className={styles.fieldWide}>
        <label htmlFor={fieldId("commitment-description")} className={styles.label}>
          Commitment
        </label>
        <input
          id={fieldId("commitment-description")}
          name="description"
          required
          placeholder="A specific, verifiable step."
          className={styles.input}
          disabled={pending}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor={fieldId("commitment-priority")} className={styles.label}>
          Quarterly Priority
        </label>
        <select
          id={fieldId("commitment-priority")}
          name="priority_id"
          required
          className={styles.select}
          defaultValue=""
          disabled={pending}
        >
          <option value="" disabled>
            Pick a priority…
          </option>
          {[...groups.entries()].map(([parentLabel, choices]) => (
            <optgroup key={parentLabel} label={parentLabel}>
              {choices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.title}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label htmlFor={fieldId("commitment-owner")} className={styles.label}>
          Owner
        </label>
        <select
          id={fieldId("commitment-owner")}
          name="owner_id"
          className={styles.select}
          defaultValue={defaultOwnerId ?? ""}
          disabled={pending}
        >
          <option value="">Unassigned</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.full_name}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label htmlFor={fieldId("commitment-due")} className={styles.label}>
          Due date
        </label>
        <input
          id={fieldId("commitment-due")}
          name="due_date"
          type="date"
          defaultValue={defaultDueDate}
          className={styles.input}
          disabled={pending}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.checkboxLabel} htmlFor={fieldId("commitment-ongoing")}>
          <input
            id={fieldId("commitment-ongoing")}
            name="is_ongoing"
            type="checkbox"
            value="true"
            disabled={pending}
          />
          Ongoing (weekly)
        </label>
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
          disabled={pending}
        >
          {pending ? "Adding…" : "Add commitment"}
        </button>
        <ConfirmationChip visible={confirmationVisible} />
      </div>
    </form>
  );
}
