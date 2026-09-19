"use client";

import { useMemo, useState, useTransition } from "react";
import {
  logMeasureEntriesAction,
  type MeasureEntryInput,
} from "@/lib/measures/actions";
import type {
  MeasureTreeFunction,
  MeasureTreeCsf,
} from "@/lib/measures/service";
import type { MetricValueType, TargetDirection } from "@/lib/types";
import { formatShortDate } from "@/lib/dates";
import styles from "../admin/companies/admin.module.css";
import localStyles from "./measures.module.css";
import { FunctionSection } from "./FunctionSection";

// The /measures manager. One surface for both authoring critical
// success factors and logging the week, filtered by function so the
// reader can find a row without a search. Filter chips and tracking
// inputs disappear when the company doesn't have
// performance_tracking on: the surface degrades to pure authoring.
//
// FLAT SINCE 0216. Every list here used to be built by walking a CSF
// and then the KPIs beneath it, which is why so many of them read
// `flatMap((o) => [o, ...o.measures])`. One kind, one level, one
// map.

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
}: {
  functions: MeasureTreeFunction[];
  weekEnding: string;
  isAdmin: boolean;
  trackingEnabled: boolean;
}) {
  // Every row the chips count and filter.
  //
  // The chips used to count KPIs only, which put two different
  // numbers for the same job side by side: "9 not yet logged" beside
  // "28 of 28 still to log". Both were arithmetically right over
  // different populations, which is exactly the shape of the
  // follow-through bug on the companies page. One population now,
  // and since 0216 only one population exists to get wrong.
  //
  // A CSF's name lives in `title`; status and filtering read
  // `description`. Mapped at the boundary so both see one shape.
  const allMeasures = useMemo(
    () => functions.flatMap((f) => f.csfs.map((c) => ({ ...c, description: c.title }))),
    [functions]
  );

  // Only what this caller can actually write. A count that included
  // other people's functions would tell a reader they had six things
  // to do when they have none, and would never reach zero.
  const myEntryTargets = useMemo(
    () =>
      functions
        .filter((f) => f.canLog)
        .flatMap((f) => f.csfs.map((c) => c.id)),
    [functions]
  );

  const allEntryTargets = useMemo(
    () =>
      functions.flatMap((f) =>
        f.csfs.map((c) => ({
          id: c.id,
          value_type: c.value_type,
          currentValue: c.currentValue,
        }))
      ),
    [functions]
  );

  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      allEntryTargets.map((m) => [
        m.id,
        formatEntryValue(m.value_type, m.currentValue),
      ])
    )
  );
  const [activeChips, setActiveChips] = useState<Set<MeasureStatus>>(
    () => new Set()
  );

  const [pending, startTransition] = useTransition();
  // Which function's save is in flight, so only that card's button
  // shows a spinner instead of every one of them at once.
  const [savingFunctionId, setSavingFunctionId] = useState<string | null>(
    null
  );
  const [message, setMessage] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  const stats = useMemo(() => computeStats(allMeasures), [allMeasures]);

  // What most visits are actually asking. The counts existed inside
  // the filter chips already; nobody had ever stated it as a
  // sentence, so a leader had to scan every row of every card to find
  // the two boxes still empty.
  //
  // Counts both kinds and reads the live inputs, not the saved
  // values, so typing a number makes the number go down before the
  // save lands.
  // True when the page shows functions this caller cannot log.
  const scoped = myEntryTargets.length < allEntryTargets.length;

  const outstanding = useMemo(
    () => myEntryTargets.filter((id) => !(values[id] ?? "").trim()).length,
    [myEntryTargets, values]
  );
  const anyTargets = allMeasures.some((m) => !!m.target?.trim());

  function isVisible(measure: MeasureTreeCsf & { description: string }): boolean {
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

  // Saves one function's values, not the page's.
  //
  // This used to be a single page-level button. That implied one
  // person sits down and fills in the whole company, when in fact
  // every function head manages their own critical success factors.
  // A save control that spans other people's functions describes a
  // workflow nobody actually follows.
  //
  // Admins and guides still see every function, so they can still
  // enter values on someone's behalf — they just do it one function
  // at a time, which is how the accountability actually sits.
  function saveFunction(fn: MeasureTreeFunction) {
    setMessage(null);
    const entries: MeasureEntryInput[] = fn.csfs.map((c) => ({
      measureId: c.id,
      valueType: c.value_type,
      rawValue: values[c.id] ?? "",
    }));
    setSavingFunctionId(fn.id);
    startTransition(async () => {
      const result = await logMeasureEntriesAction(entries, weekEnding);
      setSavingFunctionId(null);
      if (result.ok) {
        setMessage({
          ok: true,
          text:
            result.savedCount === 0
              ? `Nothing to save for ${fn.title} — enter values first.`
              : `Saved ${result.savedCount} value${
                  result.savedCount === 1 ? "" : "s"
                } for ${fn.title}.`,
        });
      } else {
        setMessage({ ok: false, text: result.message });
      }
    });
  }

  return (
    <div className={localStyles.managerStack}>
      {/* The chips filter the function list below and nothing else.
          They used to sit loose between the board and the list, which
          made them read as a page-level toolbar governing both — and
          clicking one while half the screen ignored you is the kind
          of thing people quietly stop trusting. Housed with the list
          they filter, under a heading that says so. */}
      {trackingEnabled ? (
        <div className={localStyles.managerHeader}>
          <div className={localStyles.managerHeaderTop}>
            <h2 className={localStyles.managerHeading}>By function</h2>
            {/* Silent for someone with nothing to log — a reader does
                not need a to-do line about other people's numbers. */}
            {myEntryTargets.length > 0 ? (
              <p
                className={
                  outstanding === 0
                    ? localStyles.outstandingDone
                    : localStyles.outstanding
                }
              >
                {/* Says "on your functions" only when there are
                    others on screen. For an admin, who can log
                    everything, this line and the chips describe the
                    same set and the qualifier would be noise. For a
                    leader they differ, and two unqualified numbers
                    side by side is the confusion this whole change
                    was about. */}
                {outstanding === 0
                  ? `All ${myEntryTargets.length} logged for the week ending ${formatShortDate(weekEnding)}${scoped ? " on your functions" : ""}.`
                  : `${outstanding} of ${myEntryTargets.length} still to log for the week ending ${formatShortDate(weekEnding)}${scoped ? " on your functions" : ""}.`}
              </p>
            ) : null}
          </div>
          {anyTargets ? (
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
          ) : null}
        </div>
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
          authoring={isAdmin}
          trackingEnabled={trackingEnabled}
          weekEnding={weekEnding}
          onSave={() => saveFunction(fn)}
          saving={savingFunctionId === fn.id}
        />
      ))}

      {message ? (
        <p
          role={message.ok ? "status" : "alert"}
          className={
            message.ok ? styles.successMessage : styles.errorMessage
          }
        >
          {message.text}
        </p>
      ) : null}


    </div>
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

// Structural, not tied to the tree's shape. It takes the three
// fields it reads, which is what lets ManagedMeasureRow call it on a
// row and what kept it working when 0216 changed the row type
// underneath it.
export type StatusRow = {
  value_type: MetricValueType;
  target: string | null;
  target_direction: TargetDirection;
  currentValue: { number: number | null; text: string | null } | null;
};

export function computeStatus(measure: StatusRow): MeasureStatus {
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

function computeStats(measures: StatusRow[]) {
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
