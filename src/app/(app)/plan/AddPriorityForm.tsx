"use client";

import { useActionState, useId } from "react";
import {
  createPriorityAction,
  type PlanResult,
} from "@/lib/plan/actions";
import type {
  AnnualGoal,
  Priority,
  Profile,
  StrategicFocusArea,
} from "@/lib/types";
import { PriorityParentOptions } from "./PriorityParentOptions";
import { useStayOpenForm } from "@/lib/hooks/use-stay-open-form";
import { ConfirmationChip } from "@/components/ui/ConfirmationChip";
import styles from "./plan.module.css";

const INITIAL: PlanResult<Priority> = { ok: false, message: "" };

export function AddPriorityForm({
  quarterId,
  defaultParent,
  goalOptions,
  sfaOptions,
  people,
}: {
  quarterId: string;
  // The wire form of a parent ref ("goal:<id>", "sfa:<id>" or "").
  // When this form is mounted UNDER a parent — inline in the cascade,
  // or on a detail page — that parent is implied by where the reader
  // clicked, so the picker is hidden and this is sent as-is.
  defaultParent: string;
  goalOptions: Pick<AnnualGoal, "id" | "title">[];
  sfaOptions: Pick<StrategicFocusArea, "id" | "title">[];
  people: Pick<Profile, "id" | "full_name">[];
}) {
  const [state, formAction, pending] = useActionState<
    PlanResult<Priority>,
    FormData
  >(createPriorityAction, INITIAL);

  // Field ids are SCOPED PER FORM INSTANCE. These forms render many
  // times on /plan — once in the toolbar, once inside every focus
  // area, once under every goal — and a fixed id would put several
  // elements with the same id in one document. That is invalid HTML,
  // and it breaks the thing the id is for: <label htmlFor> resolves
  // to the FIRST match, so clicking a field's own label focuses a
  // different form's field. `useId` gives each instance its own.
  const uid = useId();
  const fieldId = (name: string) => `${name}-${uid}`;
  const errorMessage =
    state && "ok" in state && !state.ok && state.message ? state.message : null;
  const { formRef, confirmationVisible } = useStayOpenForm(
    state,
    pending,
    (s) => Boolean(s && "ok" in s && s.ok),
    { closeAncestor: "details" }
  );

  return (
    <form action={formAction} className={styles.form} ref={formRef}>
      <input type="hidden" name="quarter_id" value={quarterId} />

      <div className={styles.fieldWide}>
        <label htmlFor={fieldId("priority-title")} className={styles.label}>
          Title
        </label>
        <input
          id={fieldId("priority-title")}
          name="title"
          required
          className={styles.input}
          disabled={pending}
        />
      </div>

      {/* The parent picker is redundant when we've been mounted under
          a specific parent (cascade inline add, or a detail page):
          the reader already answered it by choosing where to click.
          Send it hidden and keep the visible form on what context
          does not imply. */}
      {defaultParent ? (
        <input type="hidden" name="parent" value={defaultParent} />
      ) : (
        <div className={styles.field}>
          <label htmlFor={fieldId("priority-parent")} className={styles.label}>
            Parent
          </label>
          <select
            id={fieldId("priority-parent")}
            name="parent"
            className={styles.select}
            defaultValue={defaultParent}
            disabled={pending}
          >
            <PriorityParentOptions
              goalOptions={goalOptions}
              sfaOptions={sfaOptions}
            />
          </select>
        </div>
      )}

      <div className={styles.field}>
        <label htmlFor={fieldId("priority-owner")} className={styles.label}>
          Owner
        </label>
        <select
          id={fieldId("priority-owner")}
          name="owner_id"
          defaultValue=""
          className={styles.select}
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
        <label htmlFor={fieldId("priority-due")} className={styles.label}>
          Due date
        </label>
        <input
          id={fieldId("priority-due")}
          name="due_date"
          type="date"
          className={styles.input}
          disabled={pending}
        />
      </div>

      <div className={styles.fieldWide}>
        <label htmlFor={fieldId("priority-description")} className={styles.label}>
          Description
        </label>
        <textarea
          id={fieldId("priority-description")}
          name="description"
          className={styles.textarea}
          rows={2}
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
          disabled={pending}
        >
          {pending ? "Adding…" : "Add quarterly priority"}
        </button>
        <ConfirmationChip visible={confirmationVisible} />
      </div>
    </form>
  );
}
