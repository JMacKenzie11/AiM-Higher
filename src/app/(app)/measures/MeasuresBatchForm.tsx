"use client";

import { useState, useTransition } from "react";
import {
  logMeasureEntriesAction,
  type MeasureEntryInput,
} from "@/lib/measures/actions";
import type { OwnedMeasure } from "@/lib/measures/service";
import styles from "../admin/companies/admin.module.css";

// Save-all batch entry for the current week's numbers. Values are
// held in local state; blank rows are ignored on submit so a user
// can log some measures now and the rest later. Confirmation is a
// simple text message + form clears + inputs stay in place with the
// values they just saved.

export function MeasuresBatchForm({
  measures,
  weekEnding,
}: {
  measures: OwnedMeasure[];
  weekEnding: string;
}) {
  const initialValues = () =>
    Object.fromEntries(
      measures.map((m) => {
        const cur = m.currentValue;
        const initial =
          cur == null
            ? ""
            : m.value_type === "text"
              ? cur.text ?? ""
              : cur.number != null
                ? String(cur.number)
                : "";
        return [m.id, initial];
      })
    ) as Record<string, string>;
  const [values, setValues] = useState<Record<string, string>>(initialValues());
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

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
      <h2 className={styles.h2}>Measures</h2>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Measure</th>
            <th>Target</th>
            <th style={{ width: "160px" }}>This week</th>
            <th>Recent</th>
          </tr>
        </thead>
        <tbody>
          {measures.map((m) => (
            <tr key={m.id}>
              <td>
                <div style={{ fontWeight: 600 }}>{m.description}</div>
                <div className={styles.mutedCell}>
                  {m.functionTitle} · {m.outcomeTitle}
                </div>
              </td>
              <td className={styles.mutedCell}>
                {m.target ?? "—"}
                {m.target ? (
                  <div style={{ fontSize: "11px" }}>
                    {m.target_direction === "higher_is_better"
                      ? "Higher is better"
                      : "Lower is better"}
                  </div>
                ) : null}
              </td>
              <td>
                <input
                  type={m.value_type === "text" ? "text" : "number"}
                  step="any"
                  className={styles.input}
                  value={values[m.id] ?? ""}
                  onChange={(e) =>
                    setValues((prev) => ({ ...prev, [m.id]: e.target.value }))
                  }
                  disabled={pending}
                  placeholder={
                    m.value_type === "percent"
                      ? "0 – 100"
                      : m.value_type === "text"
                        ? "Yes / No"
                        : "0"
                  }
                />
              </td>
              <td className={styles.mutedCell}>
                <MiniTrend measure={m} weekEnding={weekEnding} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

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

// Renders the last few weeks as a compact "week: value" list.
// Kept text-based rather than a chart on purpose — reading tiny
// numbers on a chart when you're logging today's is more overhead
// than signal.
function MiniTrend({
  measure,
  weekEnding,
}: {
  measure: OwnedMeasure;
  weekEnding: string;
}) {
  const rows = measure.recent
    .filter((r) => r.weekEnding !== weekEnding)
    .slice(0, 4);
  if (rows.length === 0) {
    return <span>—</span>;
  }
  return (
    <span style={{ display: "inline-flex", gap: "var(--space-3)" }}>
      {rows.map((r) => (
        <span key={r.weekEnding}>
          {r.number != null
            ? String(r.number)
            : r.text != null
              ? r.text
              : "—"}
        </span>
      ))}
    </span>
  );
}
