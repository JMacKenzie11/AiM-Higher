"use client";

import Link from "next/link";
import { useState } from "react";
import type {
  MeasureTreeFunction,
  MeasureTreeMeasure,
} from "@/lib/measures/service";
import styles from "./measures.module.css";
import uiStyles from "@/components/ui/ui.module.css";
import { OutcomeSection } from "./OutcomeSection";
import { AddOutcomeInline } from "./AddOutcomeInline";

export function FunctionSection({
  fn,
  isVisible,
  values,
  onValueChange,
  disabled,
  isAdmin,
  authoring,
  trackingEnabled,
  rdEnabled,
  weekEnding,
  onSave,
  saving,
}: {
  fn: MeasureTreeFunction;
  isVisible: (m: MeasureTreeMeasure) => boolean;
  values: Record<string, string>;
  onValueChange: (id: string, v: string) => void;
  disabled: boolean;
  isAdmin: boolean;
  // Seeing every function is an admin question; showing the add and
  // delete controls is a mode question. They were the same flag.
  authoring: boolean;
  trackingEnabled: boolean;
  rdEnabled: boolean;
  weekEnding: string;
  onSave: () => void;
  saving: boolean;
}) {
  const [addOutcomeOpen, setAddOutcomeOpen] = useState(false);
  const outcomesWithVisibleRows = fn.outcomes.filter((o) =>
    // If admin can author, show the outcome even when no measures pass
    // the current filter — otherwise the "add KPI" affordance
    // disappears and a chip filter silently blocks authoring.
    isAdmin
      ? true
      : o.measures.length === 0
        ? false
        : o.measures.some(isVisible)
  );

  // Hide entire function when no outcome shows through and the user
  // can't add anything. Admins always see the function so they can
  // add outcomes to it.
  if (outcomesWithVisibleRows.length === 0 && !isAdmin) return null;

  return (
    <section
      id={`fn-${fn.id}`}
      className={styles.fnSection}
      aria-labelledby={`fn-title-${fn.id}`}
    >
      <header className={styles.fnHeader}>
        <h2 id={`fn-title-${fn.id}`} className={styles.fnTitle}>
          <Link href={`/chart/function/${fn.id}`} className={styles.fnTitleLink}>
            {fn.title}
          </Link>
        </h2>
      </header>

      {outcomesWithVisibleRows.length === 0 ? (
        <p className={styles.fnEmpty}>
          No outcomes yet. Add the first below.
        </p>
      ) : (
        outcomesWithVisibleRows.map((o) => (
          <OutcomeSection
            key={o.id}
            outcome={o}
            functionId={fn.id}
            isVisible={isVisible}
            values={values}
            onValueChange={onValueChange}
            disabled={disabled}
            isAdmin={isAdmin}
            authoring={authoring}
            trackingEnabled={trackingEnabled}
            rdEnabled={rdEnabled}
            weekEnding={weekEnding}
          />
        ))
      )}

      {trackingEnabled && outcomesWithVisibleRows.length > 0 ? (
        <div className={styles.fnSaveRow}>
          <button
            type="button"
            // The shared primary button, same as every other save in
            // the app. This referenced a local class that does not
            // exist in the stylesheet, so it rendered unstyled.
            className={uiStyles.btnPrimary}
            onClick={onSave}
            disabled={disabled}
          >
            {/* The function's name is already the card's heading
                directly above, so repeating it here only made the
                button wide enough to read as something else. */}
            {saving ? "Saving…" : "Save this week"}
          </button>
        </div>
      ) : null}

      {authoring ? (
        addOutcomeOpen ? (
          <div className={styles.addPanel}>
            <AddOutcomeInline
              functionId={fn.id}
              onAdded={() => setAddOutcomeOpen(false)}
            />
            <button
              type="button"
              className={styles.addPanelClose}
              onClick={() => setAddOutcomeOpen(false)}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={styles.addToggleButton}
            onClick={() => setAddOutcomeOpen(true)}
          >
            + Add a critical success factor
          </button>
        )
      ) : null}
    </section>
  );
}
