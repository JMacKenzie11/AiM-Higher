"use client";

import { useState, useTransition } from "react";
import { setCompanyFeaturesAction } from "@/lib/companies/actions";
import styles from "../admin.module.css";

// Toggle module entitlements for an existing company. Disabling a
// module removes the row from company_features (hides it in nav +
// stops feeding coaching) but leaves the underlying data intact.
// Re-enable and it's all still there.

const FEATURES: ReadonlyArray<{
  value: string;
  label: string;
  hint?: string;
}> = [
  { value: "execution", label: "Execution Platform" },
  { value: "strengths", label: "Strengths" },
  {
    value: "performance_tracking",
    label: "Performance tracking",
    hint: "Turn on to require targets on every success measure and enable weekly performance nudges.",
  },
];

export function FeaturesForm({
  companyId,
  initial,
}: {
  companyId: string;
  initial: string[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(initial));
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null
  );

  function toggle(value: string) {
    setMessage(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  function save() {
    setMessage(null);
    startTransition(async () => {
      const result = await setCompanyFeaturesAction(
        companyId,
        Array.from(selected)
      );
      if (result.ok) {
        setMessage({ ok: true, text: "Features updated." });
      } else {
        setMessage({ ok: false, text: result.message });
      }
    });
  }

  const dirty =
    selected.size !== initial.length ||
    initial.some((f) => !selected.has(f)) ||
    Array.from(selected).some((f) => !initial.includes(f));

  return (
    <div className={styles.form}>
      <div className={`${styles.field} ${styles.formFull}`}>
        <span className={styles.label}>Features</span>
        <div className={styles.checkGroup}>
          {FEATURES.map((f) => (
            <div key={f.value}>
              <label className={styles.checkOption}>
                <input
                  type="checkbox"
                  checked={selected.has(f.value)}
                  onChange={() => toggle(f.value)}
                  disabled={pending}
                />
                {f.label}
              </label>
              {f.hint ? (
                <p
                  className={styles.fieldHint}
                  style={{ marginLeft: "var(--space-4)", marginTop: "var(--space-1)" }}
                >
                  {f.hint}
                </p>
              ) : null}
            </div>
          ))}
        </div>
        <p className={styles.fieldHint}>
          Disabling a module hides it in the nav and stops it from feeding
          coaching guidance. Existing data is kept — re-enable later and
          everything is still there.
        </p>
      </div>

      {message ? (
        <p
          role={message.ok ? "status" : "alert"}
          className={message.ok ? styles.successMessage : styles.errorMessage}
        >
          {message.text}
        </p>
      ) : null}

      <div className={styles.submitRow}>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={save}
          disabled={pending || !dirty || selected.size === 0}
        >
          {pending ? "Saving…" : "Save features"}
        </button>
      </div>
    </div>
  );
}
