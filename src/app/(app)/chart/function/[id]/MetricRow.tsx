"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  archiveMeasureAction,
  updateMeasureAction,
  upsertMeasureEntryAction,
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
  entries,
  canEdit,
  canLog,
  weekEnding,
}: {
  measure: SuccessMeasure;
  entries: SuccessMeasureEntry[];
  canEdit: boolean;
  canLog: boolean;
  weekEnding: string;
}) {
  const [editing, setEditing] = useState(false);
  const latest = entries[0] ?? null;
  const currentWeekEntry =
    entries.find((e) => e.week_ending === weekEnding) ?? null;

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
      {canLog ? (
        <InlineWeeklyLogger
          measure={measure}
          currentWeekEntry={currentWeekEntry}
          latest={latest}
          weekEnding={weekEnding}
        />
      ) : (
        <span
          className={valueClassName(measure, latest, styles)}
          title={latest ? `Week of ${latest.week_ending}` : "No entries yet"}
        >
          {formatValue(
            measure.value_type,
            latest?.value_number ?? null,
            latest?.value_text ?? null
          )}
        </span>
      )}
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

// Click-to-log affordance on the value pill. When the caller has
// permission to write entries for this metric (admin or the seat's
// Lead/Track), the pill turns into a text input on click; blur or
// Enter upserts to success_measure_entries for the current week and
// briefly flashes a confirmation.
function InlineWeeklyLogger({
  measure,
  currentWeekEntry,
  latest,
  weekEnding,
}: {
  measure: SuccessMeasure;
  currentWeekEntry: SuccessMeasureEntry | null;
  latest: SuccessMeasureEntry | null;
  weekEnding: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [flash, setFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<string>(() =>
    formatDraft(measure.value_type, currentWeekEntry)
  );

  useEffect(() => {
    setDraft(formatDraft(measure.value_type, currentWeekEntry));
  }, [measure.value_type, currentWeekEntry]);

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(false), 1500);
    return () => window.clearTimeout(t);
  }, [flash]);

  function commit() {
    if (pending) return;
    const next = draft.trim();
    const existing = formatDraft(measure.value_type, currentWeekEntry);
    if (next === existing) {
      setEditing(false);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await upsertMeasureEntryAction(
        measure.id,
        weekEnding,
        next
      );
      if (!result.ok) {
        setError(result.message);
      } else {
        setEditing(false);
        setFlash(true);
        router.refresh();
      }
    });
  }

  function cancel() {
    setDraft(formatDraft(measure.value_type, currentWeekEntry));
    setEditing(false);
    setError(null);
  }

  if (editing) {
    return (
      <span className={styles.detailMeasureLoggerCell}>
        <input
          className={styles.detailMeasureLoggerInput}
          type={measure.value_type === "text" ? "text" : "number"}
          step="any"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          disabled={pending}
          autoFocus
          placeholder={
            measure.value_type === "percent"
              ? "0 – 100"
              : measure.value_type === "text"
                ? "Yes / No"
                : "0"
          }
          aria-label="Log this week's value"
        />
        {error ? (
          <span role="alert" className={styles.detailMeasureLoggerError}>
            {error}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={`${valueClassName(measure, latest, styles)} ${styles.detailMeasureLoggerButton}`}
      onClick={() => setEditing(true)}
      title={
        currentWeekEntry
          ? `Logged for week of ${weekEnding} — click to update`
          : `Click to log the week ending ${weekEnding}`
      }
    >
      {formatValue(
        measure.value_type,
        latest?.value_number ?? null,
        latest?.value_text ?? null
      )}
      {flash ? <span className={styles.detailMeasureFlash}>✓</span> : null}
    </button>
  );
}

function formatDraft(
  valueType: MetricValueType,
  entry: SuccessMeasureEntry | null
): string {
  if (!entry) return "";
  if (valueType === "text") return entry.value_text ?? "";
  if (entry.value_number == null || !Number.isFinite(entry.value_number)) {
    return "";
  }
  return String(entry.value_number);
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

// Colour the latest-value pill based on how it compares to the
// target. Good = at or above/below the target for the metric's
// direction. Off = missed. Neutral covers "no target" and "no
// entries yet" — no signal to render.
function valueClassName(
  measure: SuccessMeasure,
  latest: SuccessMeasureEntry | null,
  styles: Record<string, string>
): string {
  if (!latest) {
    return `${styles.detailMeasureValue} ${styles.detailMeasureValueEmpty}`;
  }
  if (!measure.target) {
    return styles.detailMeasureValue;
  }
  const status = compareToTarget(measure, latest);
  if (status === "good") {
    return `${styles.detailMeasureValue} ${styles.detailMeasureValueGood}`;
  }
  if (status === "off") {
    return `${styles.detailMeasureValue} ${styles.detailMeasureValueOff}`;
  }
  return styles.detailMeasureValue;
}

function compareToTarget(
  measure: SuccessMeasure,
  latest: SuccessMeasureEntry
): "good" | "off" | "unknown" {
  if (measure.value_type === "text") {
    const l = (latest.value_text ?? "").trim().toLowerCase();
    const t = (measure.target ?? "").trim().toLowerCase();
    if (!l || !t) return "unknown";
    return l === t ? "good" : "off";
  }
  const value = latest.value_number;
  const targetNum = parseTargetNumber(measure.target);
  if (value == null || !Number.isFinite(value) || targetNum == null) {
    return "unknown";
  }
  if (measure.target_direction === "lower_is_better") {
    return value <= targetNum ? "good" : "off";
  }
  return value >= targetNum ? "good" : "off";
}

function parseTargetNumber(target: string | null): number | null {
  if (!target) return null;
  const cleaned = target.replace(/[^0-9.\-]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
