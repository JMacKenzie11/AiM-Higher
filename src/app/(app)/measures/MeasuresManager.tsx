"use client";

import { useMemo, useState, useTransition } from "react";
import {
  logMeasureEntriesAction,
  type MeasureEntryInput,
} from "@/lib/measures/actions";
import type {
  MeasureTreeFunction,
  MeasureTreeMeasure,
} from "@/lib/measures/service";
import type { MetricValueType, TargetDirection } from "@/lib/types";
import styles from "../admin/companies/admin.module.css";
import localStyles from "./measures.module.css";
import { FunctionSection } from "./FunctionSection";

// The /measures manager. One surface for both authoring (outcomes +
// key success measures) and weekly logging, filtered by function and
// outcome so the reader can find a row without a search. Filter
// chips + tracking inputs disappear when the company doesn't have
// performance_tracking on — the surface degrades to pure authoring.

export type MeasureStatus = "good" | "off" | "unlogged" | "no_target";

const FILTER_CHIPS: ReadonlyArray<{
  status: MeasureStatus;
  label: string;
  tone: "good" | "off" | "neutral";
}> = [
  { status: "good", label: "On target", tone: "good" },
  { status: "off", label: "Off", tone: "off" },
  { status: "unlogged", label: "Not yet logged", tone: "neutral" },
];

export function MeasuresManager({
  functions,
  weekEnding,
  isAdmin,
  trackingEnabled,
  rdEnabled,
}: {
  functions: MeasureTreeFunction[];
  weekEnding: string;
  isAdmin: boolean;
  trackingEnabled: boolean;
  rdEnabled: boolean;
}) {
  const allMeasures = useMemo(
    () =>
      functions.flatMap((f) =>
        f.outcomes.flatMap((o) => o.measures)
      ),
    [functions]
  );

  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      allMeasures.map((m) => [
        m.id,
        formatEntryValue(m.value_type, m.currentValue),
      ])
    )
  );
  const [activeChips, setActiveChips] = useState<Set<MeasureStatus>>(
    () => new Set()
  );
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  const stats = useMemo(() => computeStats(allMeasures), [allMeasures]);
  const anyTargets = allMeasures.some((m) => !!m.target?.trim());

  function isVisible(measure: MeasureTreeMeasure): boolean {
    if (!trackingEnabled) return true;
    if (activeChips.size === 0) return true;
    return activeChips.has(computeStatus(measure));
  }

  function toggleChip(status: MeasureStatus) {
    setActiveChips((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  }

  function save() {
    setMessage(null);
    const entries: MeasureEntryInput[] = allMeasures.map((m) => ({
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
              : `Saved ${result.savedCount} value${
                  result.savedCount === 1 ? "" : "s"
                }.`,
        });
      } else {
        setMessage({ ok: false, text: result.message });
      }
    });
  }

  return (
    <section className={styles.card}>
      {trackingEnabled && anyTargets ? (
        <header className={localStyles.scoreboardHeader}>
          <div className={localStyles.scoreboardStats}>
            {FILTER_CHIPS.map((chip) => {
              if (chip.status === "off" || chip.status === "good") {
                if (!anyTargets) return null;
              }
              return (
                <FilterChip
                  key={chip.status}
                  status={chip.status}
                  tone={chip.tone}
                  label={chip.label}
                  count={
                    chip.status === "good"
                      ? stats.on
                      : chip.status === "off"
                        ? stats.off
                        : stats.unlogged
                  }
                  total={stats.total}
                  active={activeChips.has(chip.status)}
                  onToggle={() => toggleChip(chip.status)}
                />
              );
            })}
          </div>
        </header>
      ) : null}

      {functions.map((fn) => (
        <FunctionSection
          key={fn.id}
          fn={fn}
          isVisible={isVisible}
          values={values}
          onValueChange={(id, v) =>
            setValues((prev) => ({ ...prev, [id]: v }))
          }
          disabled={pending}
          isAdmin={isAdmin}
          trackingEnabled={trackingEnabled}
          rdEnabled={rdEnabled}
          weekEnding={weekEnding}
        />
      ))}

      {message ? (
        <p
          role={message.ok ? "status" : "alert"}
          className={
            message.ok ? styles.successMessage : styles.errorMessage
          }
          style={{ marginTop: "var(--space-4)" }}
        >
          {message.text}
        </p>
      ) : null}

      {trackingEnabled ? (
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
      ) : null}
    </section>
  );
}

function FilterChip({
  tone,
  label,
  count,
  total,
  active,
  onToggle,
}: {
  status: MeasureStatus;
  tone: "good" | "off" | "neutral";
  label: string;
  count: number;
  total: number;
  active: boolean;
  onToggle: () => void;
}) {
  const cls = [
    localStyles.statChip,
    localStyles[`statChip_${tone}`],
    localStyles.chipButton,
    active ? localStyles.chipButtonActive : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type="button"
      className={cls}
      onClick={onToggle}
      aria-pressed={active}
      title={active ? "Click to clear filter" : `Filter to ${label}`}
    >
      <span className={localStyles.statChipCount}>{count}</span>
      <span className={localStyles.statChipLabel}>
        {label}{" "}
        <span className={localStyles.statChipTotal}>/ {total}</span>
      </span>
    </button>
  );
}

// ---- Helpers -----------------------------------------------------

export function computeStatus(measure: MeasureTreeMeasure): MeasureStatus {
  if (measure.currentValue == null) return "unlogged";
  if (!measure.target) return "no_target";
  return compareCellToTarget(
    measure,
    measure.currentValue.number,
    measure.currentValue.text
  );
}

export function compareCellToTarget(
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

function computeStats(measures: MeasureTreeMeasure[]) {
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
