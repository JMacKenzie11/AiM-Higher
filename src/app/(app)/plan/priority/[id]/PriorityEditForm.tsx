"use client";

import { useActionState } from "react";
import {
  updatePriorityAction,
  type PlanResult,
} from "@/lib/plan/actions";
import type {
  AnnualGoal,
  CascadeStatus,
  Priority,
  Profile,
} from "@/lib/types";
import styles from "../../plan-detail.module.css";

const INITIAL: PlanResult<Priority> = { ok: false, message: "" };

const STATUS_LABELS: Record<CascadeStatus, string> = {
  not_started: "Not started",
  on_track: "On track",
  behind: "Behind",
  complete: "Complete",
  ongoing: "Ongoing",
};

export function PriorityEditForm({
  priority,
  people,
  goalOptions,
  quarters,
}: {
  priority: Priority;
  people: Pick<Profile, "id" | "full_name">[];
  goalOptions: Pick<AnnualGoal, "id" | "title">[];
  quarters: Array<{ id: string; label: string; status: string }>;
}) {
  const [state, formAction, pending] = useActionState<
    PlanResult<Priority>,
    FormData
  >(updatePriorityAction, INITIAL);
  const errorMessage =
    state && "ok" in state && !state.ok && state.message ? state.message : null;
  const success = state && "ok" in state && state.ok;

  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="id" value={priority.id} />

      <div className={styles.fieldWide}>
        <label htmlFor="priority-title" className={styles.label}>
          Title
        </label>
        <input
          id="priority-title"
          name="title"
          defaultValue={priority.title}
          required
          className={styles.input}
          disabled={pending}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="priority-goal" className={styles.label}>
          Annual goal
        </label>
        <select
          id="priority-goal"
          name="annual_goal_id"
          defaultValue={priority.annual_goal_id ?? ""}
          className={styles.select}
          disabled={pending}
        >
          <option value="">Not linked</option>
          {goalOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.title}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label htmlFor="priority-quarter" className={styles.label}>
          Quarter
        </label>
        <select
          id="priority-quarter"
          name="quarter_id"
          defaultValue={priority.quarter_id}
          className={styles.select}
          disabled={pending}
        >
          {quarters.map((quarter) => (
            <option key={quarter.id} value={quarter.id}>
              {quarter.label} {quarter.status === "closed" ? "(closed)" : ""}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label htmlFor="priority-owner" className={styles.label}>
          Owner
        </label>
        <select
          id="priority-owner"
          name="owner_id"
          defaultValue={priority.owner_id ?? ""}
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
        <label htmlFor="priority-due" className={styles.label}>
          Due date
        </label>
        <input
          id="priority-due"
          name="due_date"
          type="date"
          defaultValue={priority.due_date ?? ""}
          className={styles.input}
          disabled={pending}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="priority-status" className={styles.label}>
          Status
        </label>
        <select
          id="priority-status"
          name="status"
          defaultValue={priority.status}
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
        <label htmlFor="priority-description" className={styles.label}>
          Description
        </label>
        <textarea
          id="priority-description"
          name="description"
          defaultValue={priority.description ?? ""}
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
