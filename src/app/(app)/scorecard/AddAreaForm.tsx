"use client";

import { useActionState } from "react";
import {
  createAreaAction,
  type AreaResult,
} from "@/lib/scorecard/actions";
import type { Profile } from "@/lib/types";
import styles from "./scorecard.module.css";

const INITIAL: AreaResult = { ok: false, message: "" };

export function AddAreaForm({
  roster,
}: {
  roster: Array<Pick<Profile, "id" | "full_name">>;
}) {
  const [state, formAction, pending] = useActionState<AreaResult, FormData>(
    createAreaAction,
    INITIAL
  );
  const errorMessage =
    state && "ok" in state && !state.ok && state.message ? state.message : null;

  return (
    <form action={formAction} className={styles.form}>
      <div className={styles.fieldWide}>
        <label htmlFor="area-name" className={styles.label}>
          Area name
        </label>
        <input
          id="area-name"
          name="name"
          required
          className={styles.input}
          placeholder="e.g. Sales & Marketing"
          disabled={pending}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="area-accountable" className={styles.label}>
          Accountable
        </label>
        <select
          id="area-accountable"
          name="accountable_id"
          defaultValue=""
          className={styles.select}
          disabled={pending}
        >
          <option value="">Unassigned</option>
          {roster.map((person) => (
            <option key={person.id} value={person.id}>
              {person.full_name}
            </option>
          ))}
        </select>
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
          {pending ? "Adding…" : "Add area"}
        </button>
      </div>
    </form>
  );
}
