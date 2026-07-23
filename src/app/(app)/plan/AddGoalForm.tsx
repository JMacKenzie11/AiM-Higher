"use client";

import { useActionState } from "react";
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
        <label htmlFor="goal-title" className={styles.label}>
          Title
        </label>
        <input
          id="goal-title"
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
          <label htmlFor="goal-sfa" className={styles.label}>
            Focus area
          </label>
          <select
            id="goal-sfa"
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
        <label htmlFor="goal-owner" className={styles.label}>
          Owner
        </label>
        <select
          id="goal-owner"
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
        <label htmlFor="goal-target" className={styles.label}>
          Target date
        </label>
        <input
          id="goal-target"
          name="target_date"
          type="date"
          className={styles.input}
          disabled={pending}
        />
      </div>

      <div className={styles.fieldWide}>
        <label htmlFor="goal-description" className={styles.label}>
          Description
        </label>
        <textarea
          id="goal-description"
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
          {pending ? "Adding…" : "Add annual goal"}
        </button>
        <ConfirmationChip visible={confirmationVisible} />
      </div>
    </form>
  );
}
