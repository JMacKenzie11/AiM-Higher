"use client";

import Link from "next/link";
import type {
  MeasureTreeFunction,
  MeasureTreeMeasure,
} from "@/lib/measures/service";
import styles from "./measures.module.css";
import { OutcomeSection } from "./OutcomeSection";
import { AddOutcomeInline } from "./AddOutcomeInline";

export function FunctionSection({
  fn,
  isVisible,
  values,
  onValueChange,
  disabled,
  isAdmin,
  trackingEnabled,
  rdEnabled,
  weekEnding,
}: {
  fn: MeasureTreeFunction;
  isVisible: (m: MeasureTreeMeasure) => boolean;
  values: Record<string, string>;
  onValueChange: (id: string, v: string) => void;
  disabled: boolean;
  isAdmin: boolean;
  trackingEnabled: boolean;
  rdEnabled: boolean;
  weekEnding: string;
}) {
  const outcomesWithVisibleRows = fn.outcomes.filter((o) =>
    // If admin can author, show the outcome even when no measures pass
    // the current filter — otherwise the "add measure" affordance
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
            trackingEnabled={trackingEnabled}
            rdEnabled={rdEnabled}
            weekEnding={weekEnding}
          />
        ))
      )}

      {isAdmin ? <AddOutcomeInline functionId={fn.id} /> : null}
    </section>
  );
}
