"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  createMeasureAction,
  type ChartResult,
} from "@/lib/chart/actions";
import type { MetricValueType, SuccessMeasure } from "@/lib/types";
import styles from "../../chart.module.css";

// Always-live "add a metric" row matched to the roles list rhythm.
// Three visible fields — description, target, value type — then Add
// (or press Enter). Direction defaults to higher_is_better and
// auto_track stays on; both are editable per-metric via the row's
// Edit affordance after creation so the sub-form doesn't need to
// nag every new-metric user.

const INITIAL: ChartResult<SuccessMeasure> = { ok: false, message: "" };

const VALUE_TYPES: Array<{ value: MetricValueType; label: string }> = [
  { value: "number", label: "Number" },
  { value: "percent", label: "Percent" },
  { value: "text", label: "Yes / No" },
];

export function AddMetricRow({ outcomeId }: { outcomeId: string }) {
  const [state, formAction, pending] = useActionState<
    ChartResult<SuccessMeasure>,
    FormData
  >(createMeasureAction, INITIAL);
  const [description, setDescription] = useState("");
  const [target, setTarget] = useState("");
  const [valueType, setValueType] = useState<MetricValueType>("number");
  const descriptionRef = useRef<HTMLInputElement>(null);
  const errorMessage =
    state && "ok" in state && !state.ok && state.message ? state.message : null;

  useEffect(() => {
    if (state && "ok" in state && state.ok) {
      setDescription("");
      setTarget("");
      setValueType("number");
      descriptionRef.current?.focus();
    }
  }, [state]);

  return (
    <form action={formAction} className={styles.addMetricRow}>
      <input type="hidden" name="outcome_id" value={outcomeId} />
      <input type="hidden" name="target_direction" value="higher_is_better" />
      <input type="hidden" name="auto_track" value="on" />

      <input
        ref={descriptionRef}
        type="text"
        name="description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            setDescription("");
            setTarget("");
          }
        }}
        className={styles.addMetricInput}
        placeholder="Add a metric — e.g. % of projects on time"
        required
        disabled={pending}
        aria-label="New metric"
      />

      <input
        type="text"
        name="target"
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        className={styles.addMetricTarget}
        placeholder={
          valueType === "percent"
            ? "e.g. 90%"
            : valueType === "text"
              ? "e.g. Yes"
              : "e.g. 0.95"
        }
        disabled={pending}
        aria-label="Target"
      />

      <select
        name="value_type"
        value={valueType}
        onChange={(e) => setValueType(e.target.value as MetricValueType)}
        className={styles.addMetricType}
        disabled={pending}
        aria-label="Value type"
      >
        {VALUE_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>

      <button
        type="submit"
        className={styles.rolePrimaryButton}
        disabled={pending || !description.trim()}
      >
        {pending ? "Adding…" : "Add"}
      </button>

      {errorMessage ? (
        <p role="alert" className={styles.roleError}>
          {errorMessage}
        </p>
      ) : null}
    </form>
  );
}
