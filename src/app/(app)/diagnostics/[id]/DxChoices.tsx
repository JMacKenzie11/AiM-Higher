"use client";

import { useId, useState } from "react";
import { updateDiagnosticAction } from "@/lib/diagnostics/actions";
import { KNOWLEDGE_ITEMS, type KnowledgeBase } from "@/lib/diagnostics/types";
import { useDxAction } from "../useDxAction";
import admin from "../../admin/companies/admin.module.css";
import styles from "../diagnostics.module.css";

// Lists of ticks on the diagnostic row (0309): where requests come in,
// what an agent never does alone, and what the business has written
// down. Each tick saves at once; the text beside a list saves when the
// cursor leaves it.

function SaveState({ pending, saved, error }: { pending: boolean; saved: boolean; error: string | null }) {
  if (error) return <span className={styles.error} role="alert">{error}</span>;
  if (pending) return <span className={styles.status}>Saving…</span>;
  if (saved) return <span className={styles.status}>Saved</span>;
  return null;
}

export function DxMulti({
  diagnosticId,
  field,
  label,
  options,
  value,
}: {
  diagnosticId: string;
  field: "intake_channels" | "never_alone";
  label: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  value: string[];
}) {
  const [on, setOn] = useState<string[]>(value);
  const { pending, error, saved, run } = useDxAction();
  return (
    <fieldset className={styles.choiceList}>
      <legend className={admin.label}>{label}</legend>
      {options.map((o) => (
        <label key={o.value} className={styles.check}>
          <input
            type="checkbox"
            checked={on.includes(o.value)}
            onChange={(e) => {
              const next = e.target.checked ? [...on, o.value] : on.filter((x) => x !== o.value);
              setOn(next);
              run(() => updateDiagnosticAction(diagnosticId, { [field]: next }));
            }}
          />
          {o.label}
        </label>
      ))}
      <SaveState pending={pending} saved={saved} error={error} />
    </fieldset>
  );
}

export function KnowledgeBaseField({ diagnosticId, value }: { diagnosticId: string; value: KnowledgeBase | null }) {
  const [kb, setKb] = useState<KnowledgeBase>(value ?? {});
  const [where, setWhere] = useState(value?.where ?? "");
  const whereId = useId();
  const { pending, error, saved, run } = useDxAction();
  const save = (next: KnowledgeBase) => run(() => updateDiagnosticAction(diagnosticId, { knowledge_base: next }));
  return (
    <fieldset className={styles.choiceList}>
      <legend className={admin.label}>What the business has written down</legend>
      {KNOWLEDGE_ITEMS.map((o) => (
        <label key={o.value} className={styles.check}>
          <input
            type="checkbox"
            checked={kb[o.value] === true}
            onChange={(e) => {
              const next = { ...kb, [o.value]: e.target.checked, where };
              setKb(next);
              save(next);
            }}
          />
          {o.label}
        </label>
      ))}
      <div className={admin.field}>
        <label className={admin.label} htmlFor={whereId}>
          Where they live
        </label>
        <input
          id={whereId}
          className={admin.input}
          value={where}
          maxLength={500}
          placeholder="Google Drive, the shared drive, the website"
          onChange={(e) => setWhere(e.target.value)}
          onBlur={() => {
            if (where !== (kb.where ?? "")) {
              const next = { ...kb, where };
              setKb(next);
              save(next);
            }
          }}
        />
      </div>
      <SaveState pending={pending} saved={saved} error={error} />
    </fieldset>
  );
}
