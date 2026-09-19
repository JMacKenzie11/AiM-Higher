"use client";

import {
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  archiveMeasureAction,
  updateMeasureAction,
  type ChartResult,
} from "@/lib/chart/actions";
import { critiqueMeasureDraftAction } from "@/lib/measures/actions";
import { ruleBasedCritique } from "@/lib/measures/critique-rules";
import { shouldCritiqueOnBlur } from "@/lib/measures/critique-blur";
import type { MeasureCritique } from "@/lib/measures/critique-rules";
import type { MetricValueType, SuccessMeasure, TargetDirection } from "@/lib/types";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import uiStyles from "@/components/ui/ui.module.css";
import { ExternalSourceControls } from "./external/ExternalSourceControls";
import styles from "./measures.module.css";
import chartStyles from "../chart/chart.module.css";

// The measure settings form, and the archive control beside it.
//
// Lifted out of ManagedMeasureRow so the grid can open it in an
// expanded row without pulling in the row rendering it no longer
// uses. One form, two callers, so a field cannot appear in one place
// and not the other.
//
// `measure` is deliberately structural rather than the tree's row
// type: this form reads six fields and nothing else, and typing it to
// the shape of whatever page is calling is what made it hard to move.

const INITIAL: ChartResult<SuccessMeasure> = { ok: false, message: "" };

const VALUE_TYPES: Array<{ value: MetricValueType; label: string }> = [
  { value: "number", label: "Number" },
  { value: "percent", label: "Percent" },
  { value: "text", label: "Text (yes/no)" },
];

export type EditableMeasure = {
  id: string;
  description: string;
  target: string | null;
  value_type: MetricValueType;
  target_direction: TargetDirection;
  update_frequency: string;
  auto_track: boolean;
};

export function EditMeasureForm({
  measure,
  outcomeTitle,
  outcomeDescription,
  trackingEnabled,
  onDone,
}: {
  measure: EditableMeasure;
  outcomeTitle: string;
  outcomeDescription: string | null;
  trackingEnabled: boolean;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState<
    ChartResult<SuccessMeasure>,
    FormData
  >(updateMeasureAction, INITIAL);
  const [description, setDescription] = useState(measure.description);
  const [target, setTarget] = useState(measure.target ?? "");
  const [valueType, setValueType] = useState<MetricValueType>(
    measure.value_type
  );
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
  const fitBad = !!aiCritique?.fitHint;
  const shownHints = {
    descriptionHint: fitBad
      ? null
      : aiCritique?.descriptionHint ?? ruleHints.descriptionHint,
    targetHint: fitBad ? null : aiCritique?.targetHint ?? ruleHints.targetHint,
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

  // The event is read, not ignored: a blur caused by reaching for
  // Save or Cancel must not re-render the form, because the critique
  // panel sits above the buttons and moving them mid-click eats the
  // click. See shouldCritiqueOnBlur.
  async function runAiCritique(
    event?: Pick<React.FocusEvent<HTMLElement>, "relatedTarget">
  ) {
    if (event && !shouldCritiqueOnBlur(event)) return;
    // Target critique is meaningless without tracking on — skip the
    // AI call entirely so we don't burn tokens or write a stale
    // target_hint that would linger past a tracking flip.
    if (!trackingEnabled) return;
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
    <form action={formAction} className={chartStyles.addForm}>
      <input type="hidden" name="id" value={measure.id} />

      <p
        className={`${chartStyles.addMetricAnchor} ${chartStyles.formFieldFull}`}
      >
        Drives progress on:{" "}
        <span className={chartStyles.addMetricAnchorTitle}>
          {outcomeTitle}
        </span>
      </p>

      <label
        className={`${chartStyles.formField} ${chartStyles.formFieldFull}`}
      >
        <span className={chartStyles.formLabel}>
          Critical success factor
        </span>
        <input
          className={chartStyles.formInput}
          type="text"
          name="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={(e) => runAiCritique(e)}
          required
          disabled={pending}
          autoFocus
        />
      </label>

      {trackingEnabled ? (
        <label className={chartStyles.formField}>
          <span className={chartStyles.formLabel}>Target</span>
          <input
            className={chartStyles.formInput}
            type="text"
            name="target"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            onBlur={(e) => runAiCritique(e)}
            placeholder="e.g. 0.95, 90%, Yes"
            disabled={pending}
          />
        </label>
      ) : (
        // Tracking off — target isn't visible/editable, but preserve
        // whatever's already stored so a later tracking flip doesn't
        // wipe it. Same story for direction + auto_track below.
        <input type="hidden" name="target" value={target} />
      )}

      <label className={chartStyles.formField}>
        <span className={chartStyles.formLabel}>Value type</span>
        <select
          className={chartStyles.formSelect}
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

      {trackingEnabled ? (
        <>
          <label className={chartStyles.formField}>
            <span className={chartStyles.formLabel}>Direction</span>
            <select
              className={chartStyles.formSelect}
              name="target_direction"
              value={direction}
              onChange={(e) =>
                setDirection(e.target.value as TargetDirection)
              }
              disabled={pending}
            >
              <option value="higher_is_better">Higher is better</option>
              <option value="lower_is_better">Lower is better</option>
            </select>
          </label>

          <label className={chartStyles.formField}>
            <span className={chartStyles.formLabel}>How often to update</span>
            <select
              name="update_frequency"
              defaultValue={measure.update_frequency ?? "weekly"}
              disabled={pending}
              className={chartStyles.formInput}
            >
              <option value="weekly">Every week</option>
              <option value="biweekly">Every two weeks</option>
              <option value="monthly">Every month</option>
            </select>
          </label>

          <label
            className={`${chartStyles.formField} ${chartStyles.formFieldFull}`}
          >
            <span className={chartStyles.formLabel}>
              <input
                type="checkbox"
                name="auto_track"
                defaultChecked={measure.auto_track}
                disabled={pending}
                style={{ marginRight: "8px" }}
              />
              {/* Was "Auto-track weekly updates", which said what the
                  system does rather than what happens to the person
                  reading it, and hard-coded weekly now that frequency
                  is a choice. */}
              Remind the owner when this is due
            </span>
          </label>
        </>
      ) : (
        <>
          <input
            type="hidden"
            name="target_direction"
            value={direction}
          />
          {measure.auto_track ? (
            <input type="hidden" name="auto_track" value="on" />
          ) : null}
        </>
      )}

      {trackingEnabled &&
      (hasAnyHint || critiqueLoading) &&
      description.trim().length > 0 ? (
        <div
          className={`${chartStyles.critiquePanel} ${chartStyles.formFieldFull}`}
        >
          {shownHints.descriptionHint ? (
            <p className={chartStyles.critiqueLine}>
              <span className={chartStyles.critiqueLabel}>
                Factor
              </span>{" "}
              {shownHints.descriptionHint}
            </p>
          ) : null}
          {shownHints.targetHint ? (
            <p className={chartStyles.critiqueLine}>
              <span className={chartStyles.critiqueLabel}>Target</span>{" "}
              {shownHints.targetHint}
            </p>
          ) : null}
          {shownHints.fitHint ? (
            <p className={chartStyles.critiqueLine}>
              <span className={chartStyles.critiqueLabel}>Fit</span>{" "}
              {shownHints.fitHint}
            </p>
          ) : null}
          {critiqueLoading ? (
            <p className={chartStyles.critiqueLoading}>Reviewing…</p>
          ) : null}
        </div>
      ) : null}

      {errorMessage ? (
        <p role="alert" className={chartStyles.errorMessage}>
          {errorMessage}
        </p>
      ) : null}

      <div className={chartStyles.formSubmit}>
        <button
          type="submit"
          className={uiStyles.btnPrimary}
          disabled={pending}
        >
          {pending ? "Saving…" : "Save"}
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

export function ArchiveMeasureButton({ measureId }: { measureId: string }) {
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
        className={styles.iconDeleteButton}
        onClick={() => setConfirming(true)}
        disabled={pending}
        aria-label="Archive this KPI"
        title="Archive this KPI"
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
        title="Archive this KPI?"
        message="Historical weekly entries are kept. The KPI disappears from its critical success factor and stops feeding the weekly check."
        confirmLabel="Archive"
        tone="danger"
        onConfirm={run}
        onCancel={() => setConfirming(false)}
        pending={pending}
      />
      {message ? (
        <span role="alert" className={styles.rowError}>
          {message}
        </span>
      ) : null}
    </>
  );
}
