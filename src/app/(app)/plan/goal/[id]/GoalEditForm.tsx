"use client";

import { useActionState } from "react";
import {
  updateGoalAction,
  type PlanResult,
} from "@/lib/plan/actions";
import type {
  AnnualGoal,
  CascadeStatus,
  Profile,
  StrategicFocusArea,
} from "@/lib/types";
import styles from "../../plan-detail.module.css";

const INITIAL: PlanResult<AnnualGoal> = { ok: false, message: "" };

const STATUS_LABELS: Record<CascadeStatus, string> = {
  not_started: "Not started",
  on_track: "On track",
  behind: "Behind",
  complete: "Complete",
  ongoing: "Ongoing",
};

export function GoalEditForm({
  goal,
  people,
  sfaOptions,
}: {
  goal: AnnualGoal;
  people: Pick<Profile, "id" | "full_name">[];
  sfaOptions: Pick<StrategicFocusArea, "id" | "title">[];
}) {
  const [state, formAction, pending] = useActionState<
    PlanResult<AnnualGoal>,
    FormData
  >(updateGoalAction, INITIAL);
  const errorMessage =
    state && "ok" in state && !state.ok && state.message ? state.message : null;
  const success = state && "ok" in state && state.ok;

  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="id" value={goal.id} />

      <div className={styles.fieldWide}>
        <label htmlFor="goal-title" className={styles.label}>
          Title
        </label>
        <input
          id="goal-title"
          name="title"
          defaultValue={goal.title}
          required
          className={styles.input}
          disabled={pending}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="goal-sfa" className={styles.label}>
          Focus area
        </label>
        <select
          id="goal-sfa"
          name="sfa_id"
          defaultValue={goal.sfa_id ?? ""}
          className={styles.select}
          disabled={pending}
        >
          <option value="">Not linked</option>
          {sfaOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.title}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label htmlFor="goal-owner" className={styles.label}>
          Owner
        </label>
        <select
          id="goal-owner"
          name="owner_id"
          defaultValue={goal.owner_id ?? ""}
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
          defaultValue={goal.target_date ?? ""}
          className={styles.input}
          disabled={pending}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="goal-status" className={styles.label}>
          Status
        </label>
        <select
          id="goal-status"
          name="status"
          defaultValue={goal.status}
          className={styles.select}
          disabled={pending}
        >
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.fieldWide}>
        <label htmlFor="goal-description" className={styles.label}>
          Description
        </label>
        <textarea
          id="goal-description"
          name="description"
          defaultValue={goal.description ?? ""}
          rows={4}
          className={styles.textarea}
          disabled={pending}
        />
      </div>

      {errorMessage ? (
        <p role="alert" className={styles.errorMessage}>
          {errorMessage}
        </p>
      ) : null}
      {success && !pending ? (
        <p role="status" className={styles.successMessage}>
          Saved.
        </p>
      ) : null}

      <div className={styles.submitRow}>
        <button
          type="submit"
          className={styles.primaryButton}
          disabled={pending}
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
