"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { upsertEntryAction } from "@/lib/scorecard/actions";
import type { MetricValueType } from "@/lib/types";
import styles from "./scorecard.module.css";

// Click-to-edit cell for a single (metric, week) intersection.
//   • Click empty or filled cell (if editable) → replaces with input.
//   • Enter or blur saves. Esc reverts.
//   • Number cells right-aligned tabular-nums.
//   • Text colored success when meeting the target (numeric: >=,
//     text: exact match). Neutral otherwise; skipped when target
//     isn't parseable in its value_type.

export function ScorecardCell({
  metricId,
  weekEnding,
  valueType,
  target,
  initialValue,
  canEdit,
}: {
  metricId: string;
  weekEnding: string;
  valueType: MetricValueType;
  target: string | null;
  initialValue: string;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [displayValue, setDisplayValue] = useState(initialValue);
  const [draft, setDraft] = useState(initialValue);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // Server may have revalidated; if the server value changed while
    // we're not editing, adopt it.
    if (!editing) {
      setDisplayValue(initialValue);
      setDraft(initialValue);
    }
  }, [initialValue, editing]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  function commit(next: string) {
    if (next === displayValue) {
      setEditing(false);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await upsertEntryAction(metricId, weekEnding, next);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setDisplayValue(next.trim());
      setEditing(false);
    });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      commit(draft);
    } else if (event.key === "Escape") {
      setDraft(displayValue);
      setEditing(false);
      setError(null);
    }
  }

  const rendered = renderValue(displayValue, valueType);
  const success = meetsTarget(displayValue, target, valueType);
  const isNumeric = valueType !== "text";

  const cellClass = [
    styles.cell,
    isNumeric ? styles.cellNumeric : styles.cellText,
    canEdit && !editing ? styles.cellEditable : "",
    success === true ? styles.cellSuccess : "",
    success === false ? styles.cellBelowTarget : "",
    pending ? styles.cellPending : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (!canEdit) {
    return (
      <td className={cellClass} title={error ?? undefined}>
        {rendered || <span className={styles.cellEmpty}>—</span>}
      </td>
    );
  }

  return (
    <td
      className={cellClass}
      title={error ?? undefined}
      onClick={() => {
        if (!editing) setEditing(true);
      }}
    >
      {editing ? (
        <input
          ref={inputRef}
          className={styles.cellInput}
          type="text"
          inputMode={isNumeric ? "decimal" : "text"}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => commit(draft)}
          disabled={pending}
        />
      ) : (
        <span className={styles.cellText}>
          {rendered || <span className={styles.cellEmpty}>—</span>}
        </span>
      )}
      {error ? <span className={styles.cellError}>{error}</span> : null}
    </td>
  );
}

// ---------- helpers ----------

function renderValue(value: string, valueType: MetricValueType): string {
  if (!value) return "";
  if (valueType === "percent") {
    const numeric = Number(value.replace(/%$/, ""));
    if (!Number.isFinite(numeric)) return value;
    return `${numeric}%`;
  }
  return value;
}

function meetsTarget(
  value: string,
  target: string | null,
  valueType: MetricValueType
): boolean | null {
  if (!value || !target) return null;
  if (valueType === "text") {
    return value.trim().toLowerCase() === target.trim().toLowerCase();
  }
  const targetNumeric = Number(target.replace(/%$/, "").trim());
  const valueNumeric = Number(value.replace(/%$/, "").trim());
  if (!Number.isFinite(targetNumeric) || !Number.isFinite(valueNumeric)) {
    return null; // skip coloring when target isn't parseable
  }
  return valueNumeric >= targetNumeric;
}
