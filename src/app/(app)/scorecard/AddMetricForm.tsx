"use client";

import { useActionState } from "react";
import {
  createMetricAction,
  type MetricResult,
} from "@/lib/scorecard/actions";
import type { FunctionalArea } from "@/lib/types";
import styles from "./scorecard.module.css";

const INITIAL: MetricResult = { ok: false, message: "" };

export function AddMetricForm({
  areas,
}: {
  areas: Array<Pick<FunctionalArea, "id" | "name">>;
}) {
  const [state, formAction, pending] = useActionState<MetricResult, FormData>(
    createMetricAction,
    INITIAL
  );
  const errorMessage =
    state && "ok" in state && !state.ok && state.message ? state.message : null;

  return (
    <form action={formAction} className={styles.form}>
      <div className={styles.field}>
        <label htmlFor="metric-area" className={styles.label}>
          Area
        </label>
        <select
          id="metric-area"
          name="functional_area_id"
          required
          defaultValue=""
          className={styles.select}
          disabled={pending}
        >
          <option value="">Pick an area…</option>
          {areas.map((area) => (
            <option key={area.id} value={area.id}>
              {area.name}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.fieldWide}>
        <label htmlFor="metric-name" className={styles.label}>
          Metric name
        </label>
        <input
          id="metric-name"
          name="name"
          required
          className={styles.input}
          placeholder="e.g. # of bids submitted"
          disabled={pending}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="metric-target" className={styles.label}>
          Target
        </label>
        <input
          id="metric-target"
          name="target"
          className={styles.input}
          placeholder="e.g. 5 or 100%"
          disabled={pending}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="metric-type" className={styles.label}>
          Value type
        </label>
        <select
          id="metric-type"
          name="value_type"
          defaultValue="number"
          className={styles.select}
          disabled={pending}
        >
          <option value="number">Number</option>
          <option value="percent">Percent</option>
          <option value="text">Text</option>
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
          {pending ? "Adding…" : "Add metric"}
        </button>
      </div>
    </form>
  );
}
