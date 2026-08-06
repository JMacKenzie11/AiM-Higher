"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import {
  logMeasureEntriesAction,
  type MeasureEntryInput,
} from "@/lib/measures/actions";
import type { OwnedMeasure } from "@/lib/measures/service";
import type { MetricValueType, TargetDirection } from "@/lib/types";
import styles from "../admin/companies/admin.module.css";
import localStyles from "./measures.module.css";

// Save-all batch entry for the current week's numbers with a
// scoreboard read of where each metric stands.
//   * Blank rows are ignored on submit so a user can log some now
//     and the rest later.
//   * The current value cell is coloured against target so an owner
//     scanning the list can see red rows before green ones.
//   * An "at-risk only" filter narrows the view to rows that missed
//     target or have no value yet.
//   * Every row has a quick-log deep link so the mobile-only user
//     can hit /measures/[id] instead of the batch table.

export function MeasuresBatchForm({
  measures,
  weekEnding,
}: {
  measures: OwnedMeasure[];
  weekEnding: string;
}) {
  const initialValues = () =>
    Object.fromEntries(
      measures.map((m) => [m.id, formatEntryValue(m.value_type, m.currentValue)])
    ) as Record<string, string>;
  const [values, setValues] = useState<Record<string, string>>(initialValues());
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const [showAtRiskOnly, setShowAtRiskOnly] = useState(false);

  const visible = useMemo(() => {
    if (!showAtRiskOnly) return measures;
    return measures.filter((m) => {
      const status = computeStatus(m);
      return status === "off" || status === "unlogged";
    });
  }, [measures, showAtRiskOnly]);

  const stats = useMemo(() => computeStats(measures), [measures]);

  function save() {
    setMessage(null);
    const entries: MeasureEntryInput[] = measures.map((m) => ({
      measureId: m.id,
      valueType: m.value_type,
      rawValue: values[m.id] ?? "",
    }));
    startTransition(async () => {
      const result = await logMeasureEntriesAction(entries, weekEnding);
      if (result.ok) {
        setMessage({
          ok: true,
          text:
            result.savedCount === 0
              ? "Nothing to save — enter values first."
              : `Saved ${result.savedCount} value${result.savedCount === 1 ? "" : "s"}.`,
        });
      } else {
        setMessage({ ok: false, text: result.message });
      }
    });
  }

  return (
    <section className={styles.card}>
      <header className={localStyles.scoreboardHeader}>
        <div className={localStyles.scoreboardStats}>
          <StatChip
            tone="good"
            label="On target"
            count={stats.on}
            total={stats.total}
          />
          <StatChip
            tone="off"
            label="Off"
            count={stats.off}
            total={stats.total}
          />
          <StatChip
            tone="neutral"
            label="Not yet logged"
            count={stats.unlogged}
            total={stats.total}
          />
        </div>
        <label className={localStyles.filterToggle}>
          <input
            type="checkbox"
            checked={showAtRiskOnly}
            onChange={(e) => setShowAtRiskOnly(e.target.checked)}
          />
          At-risk only
        </label>
      </header>

      {visible.length === 0 ? (
        <p className={styles.emptyLine}>
          {showAtRiskOnly
            ? "Nothing at risk — everything either hit target this week or was already logged. Toggle the filter off to see the rest."
            : "No metrics to show."}
        </p>
      ) : (
        <table className={localStyles.scoreboardTable}>
          <thead>
            <tr>
              <th>Metric</th>
              <th>Target</th>
              <th>Recent</th>
              <th style={{ width: "140px" }}>This week</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((m) => (
              <ScoreboardRow
                key={m.id}
                measure={m}
                weekEnding={weekEnding}
                value={values[m.id] ?? ""}
                onChange={(v) =>
                  setValues((prev) => ({ ...prev, [m.id]: v }))
                }
                disabled={pending}
              />
            ))}
          </tbody>
        </table>
      )}

      {message ? (
        <p
          role={message.ok ? "status" : "alert"}
          className={message.ok ? styles.successMessage : styles.errorMessage}
        >
          {message.text}
        </p>
      ) : null}

      <div
        className={styles.submitRow}
        style={{ marginTop: "var(--space-4)" }}
      >
        <button
          type="button"
          className={styles.primaryButton}
          onClick={save}
          disabled={pending}
        >
          {pending ? "Saving…" : "Save week"}
        </button>
      </div>
    </section>
  );
}

function ScoreboardRow({
  measure,
  weekEnding,
  value,
  onChange,
  disabled,
}: {
  measure: OwnedMeasure;
  weekEnding: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  const status = computeStatus(measure);
  return (
    <tr>
      <td>
        <div className={localStyles.metricTitleCell}>
          <Link
            href={`/measures/${measure.id}`}
            className={localStyles.metricTitleLink}
            title="Open quick-log view"
          >
            {measure.description}
          </Link>
          <span className={localStyles.metricTitleContext}>
            {measure.functionTitle} · {measure.outcomeTitle}
          </span>
        </div>
      </td>
      <td className={localStyles.targetCell}>
        {measure.target ? (
          <>
            <span className={localStyles.targetValue}>{measure.target}</span>
            <span className={localStyles.targetDirection}>
              {measure.target_direction === "higher_is_better" ? "≥" : "≤"}
            </span>
          </>
        ) : (
          <span className={localStyles.targetMuted}>—</span>
        )}
      </td>
      <td>
        <TrendPills measure={measure} weekEnding={weekEnding} />
      </td>
      <td>
        <input
          type={measure.value_type === "text" ? "text" : "number"}
          step="any"
          className={statusInputClass(status, localStyles)}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={placeholderFor(measure.value_type)}
          aria-label={`${measure.description} this week`}
        />
      </td>
      <td>
        <StatusDot status={status} />
      </td>
    </tr>
  );
}

function TrendPills({
  measure,
  weekEnding,
}: {
  measure: OwnedMeasure;
  weekEnding: string;
}) {
  const rows = measure.recent
    .filter((r) => r.weekEnding !== weekEnding)
    .slice(0, 3);
  if (rows.length === 0) {
    return <span className={localStyles.trendEmpty}>—</span>;
  }
  return (
    <div className={localStyles.trendPills}>
      {rows.map((r) => {
        const label = formatCellValue(measure.value_type, r.number, r.text);
        const trendStatus = compareCellToTarget(measure, r.number, r.text);
        return (
          <span
            key={r.weekEnding}
            className={pillClass(trendStatus, localStyles)}
            title={`Week of ${r.weekEnding}`}
          >
            {label}
          </span>
        );
      })}
    </div>
  );
}

function StatChip({
  tone,
  label,
  count,
  total,
}: {
  tone: "good" | "off" | "neutral";
  label: string;
  count: number;
  total: number;
}) {
  return (
    <span className={`${localStyles.statChip} ${localStyles[`statChip_${tone}`]}`}>
      <span className={localStyles.statChipCount}>{count}</span>
      <span className={localStyles.statChipLabel}>
        {label} <span className={localStyles.statChipTotal}>/ {total}</span>
      </span>
    </span>
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
      className={`${localStyles.statusDot} ${localStyles[`statusDot_${tone}`]}`}
      title={statusLabel(status)}
      aria-label={statusLabel(status)}
    />
  );
}

// ---- Helpers -----------------------------------------------------

type MeasureStatus = "good" | "off" | "unlogged" | "no_target";

function computeStatus(measure: OwnedMeasure): MeasureStatus {
  if (measure.currentValue == null) return "unlogged";
  if (!measure.target) return "no_target";
  return compareCellToTarget(
    measure,
    measure.currentValue.number,
    measure.currentValue.text
  );
}

function compareCellToTarget(
  measure: {
    value_type: MetricValueType;
    target: string | null;
    target_direction: TargetDirection;
  },
  n: number | null,
  t: string | null
): MeasureStatus {
  if (!measure.target) return "no_target";
  if (measure.value_type === "text") {
    const left = (t ?? "").trim().toLowerCase();
    const right = measure.target.trim().toLowerCase();
    if (!left) return "unlogged";
    return left === right ? "good" : "off";
  }
  if (n == null || !Number.isFinite(n)) return "unlogged";
  const target = parseTargetNumber(measure.target);
  if (target == null) return "no_target";
  const hit =
    measure.target_direction === "lower_is_better" ? n <= target : n >= target;
  return hit ? "good" : "off";
}

function parseTargetNumber(target: string | null): number | null {
  if (!target) return null;
  const cleaned = target.replace(/[^0-9.\-]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function computeStats(measures: OwnedMeasure[]) {
  let on = 0;
  let off = 0;
  let unlogged = 0;
  for (const m of measures) {
    const s = computeStatus(m);
    if (s === "good") on += 1;
    else if (s === "off") off += 1;
    else if (s === "unlogged") unlogged += 1;
  }
  return { on, off, unlogged, total: measures.length };
}

function formatEntryValue(
  valueType: MetricValueType,
  entry: { number: number | null; text: string | null } | null
): string {
  if (!entry) return "";
  if (valueType === "text") return entry.text ?? "";
  if (entry.number == null || !Number.isFinite(entry.number)) return "";
  return String(entry.number);
}

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

function statusInputClass(
  status: MeasureStatus,
  s: Record<string, string>
): string {
  const base = s.scoreboardInput ?? "";
  if (status === "good") return `${base} ${s.scoreboardInput_good ?? ""}`;
  if (status === "off") return `${base} ${s.scoreboardInput_off ?? ""}`;
  return base;
}

function pillClass(
  status: MeasureStatus,
  s: Record<string, string>
): string {
  const base = s.trendPill ?? "";
  if (status === "good") return `${base} ${s.trendPill_good ?? ""}`;
  if (status === "off") return `${base} ${s.trendPill_off ?? ""}`;
  return base;
}
