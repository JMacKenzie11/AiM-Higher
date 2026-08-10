"use client";

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  archiveMeasureAction,
  updateMeasureAction,
  type ChartResult,
} from "@/lib/chart/actions";
import { critiqueMeasureDraftAction } from "@/lib/measures/actions";
import { ruleBasedCritique } from "@/lib/measures/critique-rules";
import type { MeasureCritique } from "@/lib/measures/critique-rules";
import type {
  MetricValueType,
  SuccessMeasure,
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
  canEdit,
  outcomeTitle,
  outcomeDescription,
}: {
  measure: SuccessMeasure;
  canEdit: boolean;
  outcomeTitle: string;
  outcomeDescription: string | null;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li className={styles.detailMeasureEditRow}>
        <EditMetricForm
          measure={measure}
          outcomeTitle={outcomeTitle}
          outcomeDescription={outcomeDescription}
          onDone={() => setEditing(false)}
        />
      </li>
    );
  }

  // Weekly-value pill deliberately not shown here — this page is
  // for describing the metric, not logging it. Logging lives on
  // /measures (and the dashboard). Keeping the description +
  // target + admin actions only reads cleaner and removes the
  // "why is there a dash?" moment when the row has no entries.
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
            className={styles.detailMeasureTargetHint}
            title="Coaching hint — refine to clear it."
          >
            <span aria-hidden>⚑</span> {measure.target_hint}
          </span>
        ) : null}
      </span>
      <span className={styles.detailMeasureTarget}>
        {measure.target ? `Target ${measure.target}` : "No target"}
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
  outcomeTitle,
  outcomeDescription,
  onDone,
}: {
  measure: SuccessMeasure;
  outcomeTitle: string;
  outcomeDescription: string | null;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState<
    ChartResult<SuccessMeasure>,
    FormData
  >(updateMeasureAction, INITIAL);
  const [description, setDescription] = useState(measure.description);
  const [target, setTarget] = useState(measure.target ?? "");
  const [valueType, setValueType] = useState<MetricValueType>(measure.value_type);
  const [direction, setDirection] = useState<TargetDirection>(
    measure.target_direction
  );
  const [aiCritique, setAiCritique] = useState<MeasureCritique | null>(null);
  const [critiqueLoading, setCritiqueLoading] = useState(false);
  const lastCritiquedKey = useRef<string | null>(null);
  const errorMessage =
    state && "ok" in state && !state.ok && state.message ? state.message : null;

  const ruleHints = useMemo(
    () => ruleBasedCritique({ description, target, valueType }),
    [description, target, valueType]
  );

  // Precedence rule mirrored from AddMetricRow: a fit problem
  // suppresses the metric/target polish hints so the user's
  // attention lands on "measure the right thing", not "sharpen a
  // mismeasurement".
  const fitBad = !!aiCritique?.fitHint;
  const shownHints = {
    descriptionHint: fitBad
      ? null
      : aiCritique?.descriptionHint ?? ruleHints.descriptionHint,
    targetHint: fitBad
      ? null
      : aiCritique?.targetHint ?? ruleHints.targetHint,
    fitHint: aiCritique?.fitHint ?? null,
  };

  useEffect(() => {
    if (state && "ok" in state && state.ok) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  useEffect(() => {
    const key = `${valueType}|${direction}|${description.trim()}|${target.trim()}`;
    if (lastCritiquedKey.current && lastCritiquedKey.current !== key) {
      setAiCritique(null);
    }
  }, [description, target, valueType, direction]);

  async function runAiCritique() {
    const d = description.trim();
    if (d.length < 4) return;
    const key = `${valueType}|${direction}|${d}|${target.trim()}`;
    if (lastCritiquedKey.current === key) return;
    lastCritiquedKey.current = key;
    setCritiqueLoading(true);
    try {
      const result = await critiqueMeasureDraftAction({
        description: d,
        target: target.trim(),
        valueType,
        direction,
        outcomeTitle,
        outcomeDescription,
      });
      setAiCritique(result);
    } finally {
      setCritiqueLoading(false);
    }
  }

  const hasAnyHint =
    !!shownHints.descriptionHint ||
    !!shownHints.targetHint ||
    !!shownHints.fitHint;

  return (
    <form action={formAction} className={styles.addForm}>
      <input type="hidden" name="id" value={measure.id} />

      <p className={`${styles.addMetricAnchor} ${styles.formFieldFull}`}>
        Should drive progress on:{" "}
        <span className={styles.addMetricAnchorTitle}>{outcomeTitle}</span>
      </p>

      <label className={`${styles.formField} ${styles.formFieldFull}`}>
        <span className={styles.formLabel}>Metric</span>
        <input
          className={styles.formInput}
          type="text"
          name="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={runAiCritique}
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
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          onBlur={runAiCritique}
          placeholder="e.g. 0.95, 90%, Yes"
          disabled={pending}
        />
      </label>

      <label className={styles.formField}>
        <span className={styles.formLabel}>Value type</span>
        <select
          className={styles.formSelect}
          name="value_type"
          value={valueType}
          onChange={(e) => setValueType(e.target.value as MetricValueType)}
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
          value={direction}
          onChange={(e) => setDirection(e.target.value as TargetDirection)}
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

      {(hasAnyHint || critiqueLoading) && description.trim().length > 0 ? (
        <div
          className={`${styles.critiquePanel} ${styles.formFieldFull}`}
        >
          {shownHints.descriptionHint ? (
            <p className={styles.critiqueLine}>
              <span className={styles.critiqueLabel}>Metric</span>{" "}
              {shownHints.descriptionHint}
            </p>
          ) : null}
          {shownHints.targetHint ? (
            <p className={styles.critiqueLine}>
              <span className={styles.critiqueLabel}>Target</span>{" "}
              {shownHints.targetHint}
            </p>
          ) : null}
          {shownHints.fitHint ? (
            <p className={styles.critiqueLine}>
              <span className={styles.critiqueLabel}>Fit</span>{" "}
              {shownHints.fitHint}
            </p>
          ) : null}
          {critiqueLoading ? (
            <p className={styles.critiqueLoading}>Reviewing…</p>
          ) : null}
        </div>
      ) : null}

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
        className={styles.roleDeleteIcon}
        onClick={() => setConfirming(true)}
        disabled={pending}
        aria-label="Archive this metric"
        title="Archive this metric"
      >
        <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden>
          <path
            d="M4 5 h8 v8 a1 1 0 0 1 -1 1 h-6 a1 1 0 0 1 -1 -1 z M6.5 5 V3.5 a1 1 0 0 1 1 -1 h1 a1 1 0 0 1 1 1 V5 M3 5 h10"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
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
