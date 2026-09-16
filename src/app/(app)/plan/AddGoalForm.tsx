"use client";

import { useActionState, useId } from "react";
import {
  createGoalAction,
  type PlanResult,
} from "@/lib/plan/actions";
import type { AnnualGoal, Profile, StrategicFocusArea } from "@/lib/types";
import { useStayOpenForm } from "@/lib/hooks/use-stay-open-form";
import { ConfirmationChip } from "@/components/ui/ConfirmationChip";
import styles from "./plan.module.css";

const INITIAL: PlanResult<AnnualGoal> = { ok: false, message: "" };

export function AddGoalForm({
  defaultSfaId,
  sfaOptions,
  people,
}: {
  defaultSfaId: string | null;
  sfaOptions: Pick<StrategicFocusArea, "id" | "title">[];
  people: Pick<Profile, "id" | "full_name">[];
}) {
  const [state, formAction, pending] = useActionState<
    PlanResult<AnnualGoal>,
    FormData
  >(createGoalAction, INITIAL);

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
      <div className={styles.field}>
        <label htmlFor={fieldId("goal-title")} className={styles.label}>
          Title
        </label>
        <input
          id={fieldId("goal-title")}
          name="title"
          required
          className={styles.input}
          disabled={pending}
        />
      </div>

      {/* When we've been mounted inside a specific SFA (detail page or
          inline under that SFA in the cascade), the picker is noise —
          there's exactly one valid parent and it's implied by where
          the form lives. Pass it via hidden input instead. */}
      {defaultSfaId && sfaOptions.length <= 1 ? (
        <input type="hidden" name="sfa_id" value={defaultSfaId} />
      ) : (
        <div className={styles.field}>
          <label htmlFor={fieldId("goal-sfa")} className={styles.label}>
            Focus area
          </label>
          <select
            id={fieldId("goal-sfa")}
            name="sfa_id"
            className={styles.select}
            defaultValue={defaultSfaId ?? ""}
            disabled={pending}
          >
            <option value="">Not linked (yet)</option>
            {sfaOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.title}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className={styles.field}>
        <label htmlFor={fieldId("goal-owner")} className={styles.label}>
          Owner
        </label>
        <select
          id={fieldId("goal-owner")}
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
        <label htmlFor={fieldId("goal-target")} className={styles.label}>
          Target date
        </label>
        <input
          id={fieldId("goal-target")}
          name="target_date"
          type="date"
          className={styles.input}
          disabled={pending}
        />
      </div>

      <div className={styles.fieldWide}>
        <label htmlFor={fieldId("goal-description")} className={styles.label}>
          Description
        </label>
        <textarea
          id={fieldId("goal-description")}
          name="description"
          className={styles.textarea}
          rows={3}
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
          {pending ? "Adding…" : "Add goal"}
        </button>
        <ConfirmationChip visible={confirmationVisible} />
      </div>
    </form>
  );
}
