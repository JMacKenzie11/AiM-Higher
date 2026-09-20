"use client";

import { formatPulledAt } from "@/lib/external-measures/receipt";
import { formatWeekBeginning } from "@/lib/dates";
import { useExternalMeasure, useExternalMeasures } from "./ExternalMeasuresContext";
import styles from "./external.module.css";

// The receipt, on the row.
//
// UNDERSTATED ON PURPOSE. A number that came from a spreadsheet is
// still just this week's number, and a loud badge beside it would
// make the mechanism more prominent than the measure. It takes the
// same caption type as the frequency tag next to it, and it is the
// only new thing on a row that does not have a mapping.
//
// It is a native <details>, so the receipt opens without any state,
// closes on Escape, and is reachable by keyboard because a summary is
// a button. The previous attempt at a panel on this page owned its
// open state in React and discarded an in-flight router.refresh();
// nothing here owns anything.

export function ExternalMeasureNote({ measureId }: { measureId: string }) {
  const info = useExternalMeasure(measureId);
  const { timezone } = useExternalMeasures();
  if (!info) return null;
  const { receipt, pulledAt, lastPull } = info;

  // A failing SCHEDULED pull has to be visible on a week it did not
  // touch. Phase 1 only ever asked about the current week, which was
  // right while a person pressed the button — they had just pressed
  // it, and the answer was on screen. Once a cron presses it, a
  // measure whose last three runs failed showed nothing at all.
  //
  // Only a FAILURE earns the note on another week. A healthy measure
  // whose last pull was a fortnight ago says nothing, because the
  // row's own "not yet logged" treatment is already the right
  // answer and a second empty state beside it is noise.
  const staleFailure =
    !receipt && !pulledAt && lastPull?.receipt.outcome === "failed"
      ? lastPull
      : null;

  if (!receipt && !pulledAt && !staleFailure) return null;

  const label = pulledAt
    ? `Pulled · ${formatPulledAt(pulledAt, timezone)}`.replace(/ · $/, "")
    : "Not pulled";

  const shown = receipt ?? staleFailure?.receipt ?? null;

  return (
    <details className={styles.noteWrap}>
      <summary
        className={pulledAt ? styles.noteTag : styles.noteTagQuiet}
        title={
          pulledAt
            ? "This week's value came from the spreadsheet. Open for the receipt."
            : "A pull ran this week and recorded nothing. Open for the reason."
        }
      >
        {label}
      </summary>
      {shown ? (
        <div className={styles.receipt}>
          <p className={styles.receiptHeadline}>{shown.headline}</p>
          {shown.problem ? (
            <p className={styles.receiptProblem}>{shown.problem}</p>
          ) : null}
          {shown.mapping ? (
            <p className={styles.receiptMapping}>{shown.mapping}</p>
          ) : null}
          <dl className={styles.receiptList}>
            {shown.lines.map((line) => (
              <div key={line.label} className={styles.receiptRow}>
                <dt className={styles.receiptLabel}>{line.label}</dt>
                <dd className={styles.receiptValue}>{line.value}</dd>
              </div>
            ))}
            {/* THE ONE LINE PHASE 2 ADDS. Where the rest of the
                receipt describes this week, this says what the last
                attempt did whenever it ran, which is the question a
                scheduled pull makes people ask. */}
            {lastPull ? (
              <div className={styles.receiptRow}>
                <dt className={styles.receiptLabel}>Last pull</dt>
                <dd className={styles.receiptValue}>
                  {/* formatWeekBeginning, not the raw field. It holds
                      the week's FRIDAY, so printing it after the words
                      "week beginning" named the wrong end of the week —
                      "week beginning 2026-09-18" for a week that BEGAN
                      on the 14th. Missed when the app was relabelled. */}
                  {lastPull.receipt.headline} (week beginning{" "}
                  {formatWeekBeginning(lastPull.weekEnding)})
                </dd>
              </div>
            ) : null}
          </dl>
        </div>
      ) : (
        <div className={styles.receipt}>
          <p className={styles.receiptHeadline}>
            This value came from the spreadsheet, but the receipt for it is no
            longer on file.
          </p>
        </div>
      )}
    </details>
  );
}
