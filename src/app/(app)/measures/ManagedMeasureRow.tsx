"use client";

import Link from "next/link";
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
import type { MeasureCritique } from "@/lib/measures/critique-rules";
import type { MeasureTreeMeasure } from "@/lib/measures/service";
import type {
  MetricValueType,
  SuccessMeasure,
  TargetDirection,
} from "@/lib/types";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import uiStyles from "@/components/ui/ui.module.css";
import { compareCellToTarget, computeStatus, type MeasureStatus } from "./MeasuresManager";
import styles from "./measures.module.css";
import chartStyles from "../chart/chart.module.css";

const INITIAL: ChartResult<SuccessMeasure> = { ok: false, message: "" };

const VALUE_TYPES: Array<{ value: MetricValueType; label: string }> = [
  { value: "number", label: "Number" },
  { value: "percent", label: "Percent" },
  { value: "text", label: "Text (yes/no)" },
];

export function ManagedMeasureRow({
  measure,
  outcomeTitle,
  outcomeDescription,
  value,
  onValueChange,
  disabled,
  isAdmin,
  trackingEnabled,
  weekEnding,
}: {
  measure: MeasureTreeMeasure;
  outcomeTitle: string;
  outcomeDescription: string | null;
  value: string;
  onValueChange: (v: string) => void;
  disabled: boolean;
  isAdmin: boolean;
  trackingEnabled: boolean;
  weekEnding: string;
}) {
  const [editing, setEditing] = useState(false);
  const status = computeStatus(measure);

  if (editing) {
    return (
      <div className={styles.measureRowEditing} role="row">
        <EditMeasureForm
          measure={measure}
          outcomeTitle={outcomeTitle}
          outcomeDescription={outcomeDescription}
          trackingEnabled={trackingEnabled}
          onDone={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div
      className={
        isAdmin
          ? `${styles.measureRow} ${styles.measureRowEditable}`
          : styles.measureRow
      }
      role="row"
    >
      <div className={styles.measureCellTitle} role="cell">
        <Link
          href={`/measures/${measure.id}`}
          className={styles.measureTitleLink}
          title={
            trackingEnabled
              ? "Open quick-log view"
              : "Open measure detail"
          }
        >
          {measure.description}
        </Link>
        {/* Only surface the coaching flag when the target is
            actually being tracked — otherwise it's a stale nag from
            a prior tracking-on period. */}
        {trackingEnabled && measure.target_hint ? (
          <span
            className={styles.measureTargetHint}
            title="Coaching hint — refine to clear it."
          >
            <span aria-hidden>⚑</span> {measure.target_hint}
          </span>
        ) : null}
      </div>
      {trackingEnabled ? (
        <>
          <div className={styles.measureCellTarget} role="cell">
            {measure.target ? (
              <>
                <span className={styles.targetValue}>{measure.target}</span>
                <span className={styles.targetDirection}>
                  {measure.target_direction === "higher_is_better" ? "≥" : "≤"}
                </span>
              </>
            ) : (
              <span className={styles.targetMuted}>—</span>
            )}
          </div>
          <div className={styles.measureCellRecent} role="cell">
            <TrendPills measure={measure} weekEnding={weekEnding} />
          </div>
          <div className={styles.measureCellInput} role="cell">
            <input
              type={measure.value_type === "text" ? "text" : "number"}
              step="any"
              className={statusInputClass(status)}
              value={value}
              onChange={(e) => onValueChange(e.target.value)}
              disabled={disabled}
              placeholder={placeholderFor(measure.value_type)}
              aria-label={`${measure.description} this week`}
            />
          </div>
          <div className={styles.measureCellDot} role="cell">
            <StatusDot status={status} />
          </div>
        </>
      ) : null}
      {isAdmin ? (
        <div className={styles.measureCellActions} role="cell">
          <button
            type="button"
            className={styles.ghostButton}
            onClick={() => setEditing(true)}
          >
            Edit
          </button>
          <ArchiveMeasureButton measureId={measure.id} />
        </div>
      ) : null}
    </div>
  );
}

function TrendPills({
  measure,
  weekEnding,
}: {
  measure: MeasureTreeMeasure;
  weekEnding: string;
}) {
  const rows = measure.recent
    .filter((r) => r.weekEnding !== weekEnding)
    .slice(0, 3);
  if (rows.length === 0) {
    return <span className={styles.trendEmpty}>—</span>;
  }
  return (
    <div className={styles.trendPills}>
      {rows.map((r) => {
        const label = formatCellValue(measure.value_type, r.number, r.text);
        const trendStatus = compareCellToTarget(measure, r.number, r.text);
        return (
          <span
            key={r.weekEnding}
            className={pillClass(trendStatus)}
            title={`Week of ${r.weekEnding}`}
          >
            {label}
          </span>
        );
      })}
    </div>
  );
}

function StatusDot({ status }: { status: MeasureStatus }) {
  const tone =
    status === "good"
      ? "good"
      : status === "off"
        ? "off"
        : status === "unlogged"
          ? "unlogged"
          : "neutral";
  return (
    <span
      className={`${styles.statusDot} ${styles[`statusDot_${tone}`]}`}
      title={statusLabel(status)}
      aria-label={statusLabel(status)}
    />
  );
}

function EditMeasureForm({
  measure,
  outcomeTitle,
  outcomeDescription,
  trackingEnabled,
  onDone,
}: {
  measure: MeasureTreeMeasure;
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

  async function runAiCritique() {
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
        Should drive progress on:{" "}
        <span className={chartStyles.addMetricAnchorTitle}>
          {outcomeTitle}
        </span>
      </p>

      <label
        className={`${chartStyles.formField} ${chartStyles.formFieldFull}`}
      >
        <span className={chartStyles.formLabel}>Key success measure</span>
        <input
          className={chartStyles.formInput}
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

      {trackingEnabled ? (
        <label className={chartStyles.formField}>
          <span className={chartStyles.formLabel}>Target</span>
          <input
            className={chartStyles.formInput}
            type="text"
            name="target"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            onBlur={runAiCritique}
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
              Auto-track weekly updates
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
              <span className={chartStyles.critiqueLabel}>Measure</span>{" "}
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
          {pending ? "Saving…" : "Save measure"}
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
        className={styles.iconDeleteButton}
        onClick={() => setConfirming(true)}
        disabled={pending}
        aria-label="Archive this measure"
        title="Archive this measure"
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
        title="Archive this measure?"
        message="Historical weekly entries are kept. The measure disappears from the outcome and stops feeding the weekly check."
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

// ---- Local helpers ----------------------------------------------

function formatCellValue(
  valueType: MetricValueType,
  n: number | null,
  t: string | null
): string {
  if (valueType === "text") return t ?? "—";
  if (n == null || !Number.isFinite(n)) return "—";
  if (valueType === "percent") return `${n}%`;
  return String(n);
}

function placeholderFor(valueType: MetricValueType): string {
  if (valueType === "percent") return "0 – 100";
  if (valueType === "text") return "Yes / No";
  return "0";
}

function statusLabel(status: MeasureStatus): string {
  if (status === "good") return "On target";
  if (status === "off") return "Off target";
  if (status === "unlogged") return "Not yet logged this week";
  return "No target set";
}

function statusInputClass(status: MeasureStatus): string {
  const base = styles.scoreboardInput ?? "";
  if (status === "good") return `${base} ${styles.scoreboardInput_good ?? ""}`;
  if (status === "off") return `${base} ${styles.scoreboardInput_off ?? ""}`;
  return base;
}

function pillClass(status: MeasureStatus): string {
  const base = styles.trendPill ?? "";
  if (status === "good") return `${base} ${styles.trendPill_good ?? ""}`;
  if (status === "off") return `${base} ${styles.trendPill_off ?? ""}`;
  return base;
}
