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
  hint: string;
}> = [
  {
    value: "execution",
    label: "Execution Platform",
    hint: "Commitments, success measures, and the coaching dashboard.",
  },
  {
    value: "strengths",
    label: "Strengths",
    hint: "Team strengths assessments, results, and strengths-aware coaching.",
  },
  {
    value: "performance_tracking",
    label: "Success Tracking",
    hint: "Requires targets on every success measure and turns on weekly performance nudges.",
  },
  {
    value: "meeting_facilitation_review",
    label: "Meeting Facilitation Review",
    hint: "After each meeting is analyzed, generate a coaching-tone review of how the meeting was run against the AiMS Weekly Leadership Meeting framework.",
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
        <ul className={styles.featureList}>
          {FEATURES.map((f) => {
            const checked = selected.has(f.value);
            return (
              <li key={f.value} className={styles.featureItem}>
                <label className={styles.featureRow}>
                  <input
                    type="checkbox"
                    className={styles.featureCheckbox}
                    checked={checked}
                    onChange={() => toggle(f.value)}
                    disabled={pending}
                  />
                  <span className={styles.featureText}>
                    <span className={styles.featureName}>{f.label}</span>
                    <span className={styles.featureHint}>{f.hint}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
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
