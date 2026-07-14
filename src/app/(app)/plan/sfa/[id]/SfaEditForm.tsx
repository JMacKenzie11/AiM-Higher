"use client";

import { useActionState } from "react";
import {
  updateSfaAction,
  type PlanResult,
} from "@/lib/plan/actions";
import type { CascadeStatus, Profile, StrategicFocusArea } from "@/lib/types";
import styles from "../../plan-detail.module.css";

const INITIAL: PlanResult<StrategicFocusArea> = { ok: false, message: "" };

const STATUS_LABELS: Record<CascadeStatus, string> = {
  not_started: "Not started",
  on_track: "On track",
  behind: "Behind",
  complete: "Complete",
  ongoing: "Ongoing",
};

export function SfaEditForm({
  sfa,
  people,
}: {
  sfa: StrategicFocusArea;
  people: Pick<Profile, "id" | "full_name">[];
}) {
  const [state, formAction, pending] = useActionState<
    PlanResult<StrategicFocusArea>,
    FormData
  >(updateSfaAction, INITIAL);
  const errorMessage =
    state && "ok" in state && !state.ok && state.message ? state.message : null;
  const success = state && "ok" in state && state.ok;

  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="id" value={sfa.id} />

      <div className={styles.fieldWide}>
        <label htmlFor="sfa-title" className={styles.label}>
          Title
        </label>
        <input
          id="sfa-title"
          name="title"
          defaultValue={sfa.title}
          required
          className={styles.input}
          disabled={pending}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="sfa-sponsor" className={styles.label}>
          Sponsor
        </label>
        <select
          id="sfa-sponsor"
          name="sponsor_id"
          defaultValue={sfa.sponsor_id ?? ""}
          className={styles.select}
          disabled={pending}
        >
          <option value="">No sponsor yet</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.full_name}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label htmlFor="sfa-status" className={styles.label}>
          Status
        </label>
        <select
          id="sfa-status"
          name="status"
          defaultValue={sfa.status}
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
        <label htmlFor="sfa-description" className={styles.label}>
          Description
        </label>
        <textarea
          id="sfa-description"
          name="description"
          defaultValue={sfa.description ?? ""}
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
