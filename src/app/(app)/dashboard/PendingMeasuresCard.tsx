"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  logMeasureEntriesAction,
  type MeasureEntryInput,
} from "@/lib/measures/actions";
import type { OwnedMeasure } from "@/lib/measures/service";
import { CardAccent } from "@/components/ui/CardAccent";
import { formatShortDate } from "@/lib/dates";
import styles from "./dashboard.module.css";

// Dashboard widget showing every measure the caller owns that isn't
// logged for the current week yet. Inline number input per row,
// Save-all button, disappears from the DOM (via revalidate) once
// every row has a value for the week.

export function PendingMeasuresCard({
  measures,
  weekEnding,
}: {
  measures: OwnedMeasure[];
  weekEnding: string;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    const entries: MeasureEntryInput[] = measures.map((m) => ({
      measureId: m.id,
      valueType: m.value_type,
      rawValue: values[m.id] ?? "",
    }));
    startTransition(async () => {
      const result = await logMeasureEntriesAction(entries, weekEnding);
      if (!result.ok) setError(result.message);
    });
  }

  const anyValues = Object.values(values).some((v) => v.trim().length > 0);

  return (
    <section className={styles.cardAccent} aria-labelledby="pending-measures">
      <CardAccent />
      <h2 id="pending-measures" className={styles.h2}>
        This week&rsquo;s numbers
      </h2>
      <p className={styles.cardMeta}>
        Log the week ending {formatShortDate(weekEnding)} — {measures.length}
        {measures.length === 1 ? " measure" : " measures"} still open.{" "}
        <Link href="/measures" className={styles.inlineLink}>
          Open batch view →
        </Link>
      </p>
      <ul style={{ listStyle: "none", padding: 0, margin: "var(--space-3) 0 0" }}>
        {measures.map((m) => (
          <li
            key={m.id}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 140px",
              gap: "var(--space-3)",
              alignItems: "center",
              padding: "var(--space-2) 0",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <div>
              <div style={{ fontWeight: 600 }}>{m.description}</div>
              <div className={styles.cardMeta}>
                {m.functionTitle}
                {m.target ? ` · Target ${m.target}` : ""}
              </div>
            </div>
            <input
              type={m.value_type === "text" ? "text" : "number"}
              step="any"
              value={values[m.id] ?? ""}
              onChange={(e) =>
                setValues((prev) => ({ ...prev, [m.id]: e.target.value }))
              }
              disabled={pending}
              placeholder={
                m.value_type === "text"
                  ? "Yes / No"
                  : m.value_type === "percent"
                    ? "0 – 100"
                    : "Value"
              }
              style={{
                width: "100%",
                padding: "6px 10px",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                fontSize: "14px",
              }}
            />
          </li>
        ))}
      </ul>

      {error ? (
        <p role="alert" style={{ color: "var(--aims-danger)", marginTop: "var(--space-3)" }}>
          {error}
        </p>
      ) : null}

      <div style={{ marginTop: "var(--space-4)" }}>
        <button
          type="button"
          onClick={save}
          disabled={pending || !anyValues}
          style={{
            padding: "8px 20px",
            borderRadius: "var(--radius-pill)",
            background: "var(--primary)",
            color: "var(--on-primary, #fff)",
            border: "none",
            fontWeight: 600,
            cursor: pending || !anyValues ? "not-allowed" : "pointer",
            opacity: pending || !anyValues ? 0.5 : 1,
          }}
        >
          {pending ? "Saving…" : "Save what I have"}
        </button>
      </div>
    </section>
  );
}
