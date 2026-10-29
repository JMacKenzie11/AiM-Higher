"use client";

import { useId, useState } from "react";
import { updateDiagnosticAction, type DiagnosticPatch } from "@/lib/diagnostics/actions";
import { useDxAction } from "../useDxAction";
import { useSaveReport } from "./SaveStatus";
import admin from "../../admin/companies/admin.module.css";
import styles from "../diagnostics.module.css";

// One field on the diagnostic row, saved when the cursor leaves it, so
// the lead can type through a step without pressing Save on each box.
// Under it, the save status (0309): Unsaved changes while typing,
// Saving… as it leaves, then Saved.

type Key = Exclude<
  keyof DiagnosticPatch,
  "access_secured" | "brief_sent" | "conversations_booked" | "pledge_sent" | "intake_channels" | "never_alone" | "knowledge_base"
>;

export function DxField({
  diagnosticId,
  field,
  label,
  value,
  multiline = false,
  type = "text",
  hint,
  placeholder,
  maxLength,
}: {
  diagnosticId: string;
  field: Key;
  label: string;
  value: string | number | null;
  multiline?: boolean;
  type?: "text" | "date" | "number";
  hint?: string;
  placeholder?: string;
  maxLength?: number;
}) {
  const id = useId();
  const initial = value == null ? "" : String(value);
  const [v, setV] = useState(initial);
  const [last, setLast] = useState(initial);
  const { pending, error, saved, run } = useDxAction();
  useSaveReport({ pending: false, dirty: v !== last });

  function save() {
    if (v === last) return;
    run(() => updateDiagnosticAction(diagnosticId, { [field]: v } as DiagnosticPatch), () => setLast(v));
  }

  return (
    <div className={admin.field}>
      <label className={admin.label} htmlFor={id}>
        {label}
      </label>
      {multiline ? (
        <textarea id={id} className={styles.textarea} value={v} onChange={(e) => setV(e.target.value)} onBlur={save} placeholder={placeholder} maxLength={maxLength} />
      ) : (
        <input
          id={id}
          className={admin.input}
          type={type}
          inputMode={type === "number" ? "decimal" : undefined}
          value={v}
          onChange={(e) => setV(e.target.value)}
          onBlur={save}
          placeholder={placeholder}
          maxLength={maxLength}
        />
      )}
      {error ? (
        <span className={styles.error} role="alert">
          {error}
        </span>
      ) : pending ? (
        <span className={styles.status}>Saving…</span>
      ) : v !== last ? (
        <span className={styles.status}>Unsaved changes</span>
      ) : saved ? (
        <span className={styles.status}>Saved</span>
      ) : hint ? (
        <span className={styles.status}>{hint}</span>
      ) : null}
    </div>
  );
}

type CheckKey = "access_secured" | "brief_sent" | "conversations_booked";

export function DxCheck({ diagnosticId, field, label, checked }: { diagnosticId: string; field: CheckKey; label: string; checked: boolean }) {
  const [on, setOn] = useState(checked);
  const { pending, error, run } = useDxAction();
  return (
    <label className={styles.check}>
      <input
        type="checkbox"
        checked={on}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.checked;
          setOn(next);
          run(() => updateDiagnosticAction(diagnosticId, { [field]: next }));
        }}
      />
      {label}
      {error ? <span className={styles.error} role="alert">{error}</span> : null}
    </label>
  );
}
