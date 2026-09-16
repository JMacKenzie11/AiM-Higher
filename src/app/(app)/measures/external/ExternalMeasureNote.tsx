"use client";

import { formatPulledAt } from "@/lib/external-measures/receipt";
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
  const { receipt, pulledAt } = info;

  // No pull has ever touched this week. A measure with a mapping and
  // no pull yet says nothing at all: the row's existing "not yet
  // logged" treatment is already the right answer and a second empty
  // state beside it would be noise.
  if (!receipt && !pulledAt) return null;

  const label = pulledAt
    ? `Pulled · ${formatPulledAt(pulledAt, timezone)}`.replace(/ · $/, "")
    : "Not pulled";

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
      {receipt ? (
        <div className={styles.receipt}>
          <p className={styles.receiptHeadline}>{receipt.headline}</p>
          {receipt.problem ? (
            <p className={styles.receiptProblem}>{receipt.problem}</p>
          ) : null}
          {receipt.mapping ? (
            <p className={styles.receiptMapping}>{receipt.mapping}</p>
          ) : null}
          <dl className={styles.receiptList}>
            {receipt.lines.map((line) => (
              <div key={line.label} className={styles.receiptRow}>
                <dt className={styles.receiptLabel}>{line.label}</dt>
                <dd className={styles.receiptValue}>{line.value}</dd>
              </div>
            ))}
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
