"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import {
  archiveMeasureAction,
  updateMeasureAction,
  type ChartResult,
} from "@/lib/chart/actions";
import type {
  MetricValueType,
  SuccessMeasure,
  SuccessMeasureEntry,
  TargetDirection,
} from "@/lib/types";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import uiStyles from "@/components/ui/ui.module.css";
import styles from "../../chart.module.css";

const INITIAL: ChartResult<SuccessMeasure> = { ok: false, message: "" };

const VALUE_TYPES: Array<{ value: MetricValueType; label: string }> = [
  { value: "number", label: "Number" },
  { value: "percent", label: "Percent" },
  { value: "text", label: "Text (yes/no)" },
];

export function MetricRow({
  measure,
  latest,
  canEdit,
}: {
  measure: SuccessMeasure;
  latest: SuccessMeasureEntry | null;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li className={styles.detailMeasureEditRow}>
        <EditMetricForm measure={measure} onDone={() => setEditing(false)} />
      </li>
    );
  }

  return (
    <li
      className={
        canEdit
          ? `${styles.detailMeasureRow} ${styles.detailMeasureRowEditable}`
          : styles.detailMeasureRow
      }
    >
      <span className={styles.detailMeasureDesc}>
        {measure.description}
        {measure.target_hint ? (
          <span
            style={{
              display: "block",
              marginTop: "4px",
              fontSize: "12px",
              color: "var(--aims-warning, #b78103)",
              fontStyle: "italic",
            }}
            title="AI suggestion — refine to clear it."
          >
            ⚑ {measure.target_hint}
          </span>
        ) : null}
      </span>
      <span className={styles.detailMeasureTarget}>
        {measure.target ? `Target ${measure.target}` : "No target"}
      </span>
      <span
        className={
          latest
            ? styles.detailMeasureValue
            : `${styles.detailMeasureValue} ${styles.detailMeasureValueEmpty}`
        }
        title={latest ? `Week of ${latest.week_ending}` : "No entries yet"}
      >
        {formatValue(
          measure.value_type,
          latest?.value_number ?? null,
          latest?.value_text ?? null
        )}
      </span>
      {canEdit ? (
        <span className={styles.detailMeasureActions}>
          <button
            type="button"
            className={styles.roleGhostButton}
            onClick={() => setEditing(true)}
          >
            Edit
          </button>
          <ArchiveMeasureButton measureId={measure.id} />
        </span>
      ) : null}
    </li>
  );
}

function EditMetricForm({
  measure,
  onDone,
}: {
  measure: SuccessMeasure;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState<
    ChartResult<SuccessMeasure>,
    FormData
  >(updateMeasureAction, INITIAL);
  const errorMessage =
    state && "ok" in state && !state.ok && state.message ? state.message : null;

  useEffect(() => {
    if (state && "ok" in state && state.ok) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction} className={styles.addForm}>
      <input type="hidden" name="id" value={measure.id} />

      <label className={`${styles.formField} ${styles.formFieldFull}`}>
        <span className={styles.formLabel}>Metric</span>
        <input
          className={styles.formInput}
          type="text"
          name="description"
          defaultValue={measure.description}
          required
          disabled={pending}
          autoFocus
        />
      </label>

      <label className={styles.formField}>
        <span className={styles.formLabel}>Target</span>
        <input
          className={styles.formInput}
          type="text"
          name="target"
          defaultValue={measure.target ?? ""}
          placeholder="e.g. 0.95, 90%, Yes"
          disabled={pending}
        />
      </label>

      <label className={styles.formField}>
        <span className={styles.formLabel}>Value type</span>
        <select
          className={styles.formSelect}
          name="value_type"
          defaultValue={measure.value_type}
          disabled={pending}
        >
          {VALUE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.formField}>
        <span className={styles.formLabel}>Direction</span>
        <select
          className={styles.formSelect}
          name="target_direction"
          defaultValue={measure.target_direction as TargetDirection}
          disabled={pending}
        >
          <option value="higher_is_better">Higher is better</option>
          <option value="lower_is_better">Lower is better</option>
        </select>
      </label>

      <label className={`${styles.formField} ${styles.formFieldFull}`}>
        <span className={styles.formLabel}>
          <input
            type="checkbox"
            name="auto_track"
            defaultChecked={measure.auto_track}
            disabled={pending}
            style={{ marginRight: "8px" }}
          />
          Auto-track weekly updates
        </span>
      </label>

      {errorMessage ? (
        <p role="alert" className={styles.errorMessage}>
          {errorMessage}
        </p>
      ) : null}

      <div className={styles.formSubmit}>
        <button type="submit" className={uiStyles.btnPrimary} disabled={pending}>
          {pending ? "Saving…" : "Save metric"}
        </button>
        <button
          type="button"
          className={uiStyles.btnGhost}
          disabled={pending}
          onClick={onDone}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function ArchiveMeasureButton({ measureId }: { measureId: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  function run() {
    setConfirming(false);
    startTransition(async () => {
      const result = await archiveMeasureAction(measureId, true);
      if (!result.ok) setMessage(result.message);
    });
  }

  return (
    <>
      <button
        type="button"
        className={styles.roleDangerButton}
        onClick={() => setConfirming(true)}
        disabled={pending}
      >
        Archive
      </button>
      <ConfirmDialog
        open={confirming}
        title="Archive this metric?"
        message="Historical weekly entries are kept. The metric disappears from the chart and stops feeding the weekly check."
        confirmLabel="Archive"
        tone="danger"
        onConfirm={run}
        onCancel={() => setConfirming(false)}
        pending={pending}
      />
      {message ? (
        <span role="alert" className={styles.roleError}>
          {message}
        </span>
      ) : null}
    </>
  );
}

function formatValue(
  valueType: MetricValueType,
  n: number | null,
  t: string | null
): React.ReactNode {
  if (valueType === "text") return t ?? "—";
  if (n === null || !Number.isFinite(n)) return "—";
  if (valueType === "percent") return `${n}%`;
  return n.toString();
}
