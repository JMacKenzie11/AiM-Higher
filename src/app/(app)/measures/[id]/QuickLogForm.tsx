"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { upsertMeasureEntryAction } from "@/lib/chart/actions";
import type { MetricValueType, SuccessMeasureEntry } from "@/lib/types";
import listStyles from "../../admin/companies/admin.module.css";
import styles from "../measures.module.css";

export function QuickLogForm({
  measureId,
  valueType,
  weekEnding,
  initialEntry,
}: {
  measureId: string;
  valueType: MetricValueType;
  weekEnding: string;
  initialEntry: SuccessMeasureEntry | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState<string>(() =>
    formatDraft(valueType, initialEntry)
  );
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  useEffect(() => {
    setValue(formatDraft(valueType, initialEntry));
  }, [valueType, initialEntry]);

  function save() {
    setMessage(null);
    const raw = value.trim();
    if (!raw) {
      setMessage({ ok: false, text: "Enter a value first." });
      return;
    }
    startTransition(async () => {
      const result = await upsertMeasureEntryAction(measureId, weekEnding, raw);
      if (result.ok) {
        setMessage({ ok: true, text: "Saved." });
        router.refresh();
      } else {
        setMessage({ ok: false, text: result.message });
      }
    });
  }

  return (
    <div>
      <input
        type={valueType === "text" ? "text" : "number"}
        step="any"
        inputMode={valueType === "text" ? "text" : "decimal"}
        className={styles.quickLogInput}
        value={value}
        onChange={(e) => {
          setMessage(null);
          setValue(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            save();
          }
        }}
        placeholder={
          valueType === "percent"
            ? "0 – 100"
            : valueType === "text"
              ? "Yes / No"
              : "0"
        }
        disabled={pending}
        autoFocus
        aria-label="This week's value"
      />

      {message ? (
        <p
          role={message.ok ? "status" : "alert"}
          className={
            message.ok ? listStyles.successMessage : listStyles.errorMessage
          }
          style={{ marginTop: "var(--space-3)" }}
        >
          {message.text}
        </p>
      ) : null}

      <div
        className={listStyles.submitRow}
        style={{ marginTop: "var(--space-4)" }}
      >
        <button
          type="button"
          className={listStyles.primaryButton}
          onClick={save}
          disabled={pending}
        >
          {pending ? "Saving…" : "Save this week"}
        </button>
      </div>
    </div>
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
