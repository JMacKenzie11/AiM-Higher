"use client";

import type { ReactNode } from "react";
import { deleteQuoteAction, updateQuoteAction } from "@/lib/diagnostics/actions";
import type { ParticipantRow, QuoteRow } from "@/lib/diagnostics/types";
import { useDxAction } from "../useDxAction";
import styles from "../diagnostics.module.css";

// Lines the readout may use. Nothing reaches the owner until the lead
// approves it, and a line carries no name unless the lead gives it one.
export function Quotes({ quotes, participants, footer }: { quotes: QuoteRow[]; participants: ParticipantRow[]; footer: ReactNode }) {
  const approved = quotes.filter((q) => q.approved_at).length;
  return (
    <section className={styles.card} aria-labelledby="dx-quotes">
      <div className={styles.cardHeader}>
        <h2 id="dx-quotes" className={styles.cardTitle}>
          Lines for the readout
        </h2>
        <span className={styles.cardMeta}>{approved} approved{approved > 3 ? ", the readout uses the first three" : ""}</span>
      </div>
      {quotes.length === 0 ? (
        <p className={styles.empty}>Select words in the notes and press Pull a quote, or press Suggest quotes.</p>
      ) : (
        <ul className={styles.plainList}>
          {quotes.map((q) => (
            <QuoteItem key={q.id} quote={q} participants={participants} />
          ))}
        </ul>
      )}
      <div className={styles.cardFooter}>{footer}</div>
    </section>
  );
}

function QuoteItem({ quote, participants }: { quote: QuoteRow; participants: ParticipantRow[] }) {
  const { pending, error, run } = useDxAction();
  return (
    <li>
      <span className={styles.quote}>&ldquo;{quote.text}&rdquo;</span>
      <span className={styles.formRow}>
        <select
          className={styles.cellInput}
          aria-label="Name shown with this line"
          value={quote.participant_id ?? ""}
          disabled={pending}
          onChange={(e) => run(() => updateQuoteAction(quote.id, { participant_id: e.target.value || null }))}
        >
          <option value="">No name</option>
          {participants.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button type="button" className={`${styles.secondary} ${styles.small}`} disabled={pending} onClick={() => run(() => updateQuoteAction(quote.id, { approved: !quote.approved_at }))}>
          {quote.approved_at ? "Unapprove" : "Approve"}
        </button>
        {quote.approved_at ? null : (
          <button type="button" className={`${styles.secondary} ${styles.small}`} disabled={pending} onClick={() => run(() => deleteQuoteAction(quote.id))}>
            Discard
          </button>
        )}
        {quote.approved_at ? <span className={styles.chip}>Approved</span> : null}
        {error ? <span className={styles.error} role="alert">{error}</span> : null}
      </span>
    </li>
  );
}
