"use client";

import { useState, useTransition } from "react";
import {
  parseChartProposal,
  chartProposalToPlainText,
  type ChartProposal,
} from "@/lib/practices/parse-chart-proposal";
import {
  applyChartProposalAction,
  type ApplySummary,
} from "@/lib/chart/apply-proposal-action";
import styles from "./ChartProposalCard.module.css";

// Renders a chart_proposal fenced block emitted by the Functional
// Chart Builder practice. Parses the JSON, previews the proposed
// structure (top seats + functions + nested sub-functions), and
// exposes Apply + Copy actions.
//
// Design decisions the card carries:
//   * LMA is always the first responsibility on every function (per
//     the practice prompt); visually emphasized so a leader
//     scanning the card knows the framework is baked in.
//   * Malformed JSON renders a fallback with a "Fix the proposal"
//     button that copies a canned nudge to the composer — the model
//     regenerates a full clean block on the next turn.
//   * Apply becomes a disabled done-state with the inline summary
//     once the action returns. Regenerating the block from a coach
//     revision produces a fresh card; the disabled state is scoped
//     to THIS card's Apply, not global.

export function ChartProposalCard({
  raw,
  streaming,
  conversationId,
  onFixRequest,
}: {
  raw: string;
  streaming: boolean;
  // The conversation this card belongs to. Passed to the Apply
  // server action so it can resolve the target company from the
  // conversation itself, not the caller's current scope cookie —
  // a sysadmin scoping between companies otherwise had chart
  // proposals land on whichever tenant they were currently viewing,
  // not the one the practice was actually about.
  conversationId: string;
  // Called when the leader clicks 'Fix the proposal' — parent
  // composes a canned nudge message and sends it as if the user
  // typed it. Optional so the card can render standalone in tests.
  onFixRequest?: () => void;
}) {
  const [applyResult, setApplyResult] = useState<ApplySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);

  const proposal = parseChartProposal(raw);

  if (!proposal) {
    return (
      <div className={styles.pending} role="status" aria-live="polite">
        {streaming ? (
          "Assembling your chart…"
        ) : (
          <>
            <p className={styles.pendingText}>
              Couldn&rsquo;t read that chart proposal.
            </p>
            {onFixRequest ? (
              <button
                type="button"
                className={styles.ghostButton}
                onClick={onFixRequest}
              >
                Fix the proposal
              </button>
            ) : null}
          </>
        )}
      </div>
    );
  }

  const apply = () => {
    if (pending || applyResult) return;
    setError(null);
    startTransition(async () => {
      const result = await applyChartProposalAction(raw, conversationId);
      if (result.ok) {
        setApplyResult(result.summary);
      } else {
        setError(result.message);
      }
    });
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(chartProposalToPlainText(proposal));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard denied — the JSON is still selectable.
    }
  };

  return (
    <article className={styles.card}>
      <header className={styles.header}>
        <div className={styles.headerMain}>
          <p className={styles.eyebrow}>Chart proposal</p>
          <h3 className={styles.title}>Your Functional Accountability Chart</h3>
          <span className={styles.rule} aria-hidden="true" />
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.ghostButton}
            onClick={() => void copy()}
          >
            {copied ? "Copied" : "Copy"}
          </button>
          {applyResult ? (
            <button
              type="button"
              className={styles.primaryButtonDone}
              disabled
              aria-label="Applied to chart"
            >
              Applied
            </button>
          ) : (
            <button
              type="button"
              className={styles.primaryButton}
              onClick={apply}
              disabled={pending}
            >
              {pending ? "Applying…" : "Apply to Chart"}
            </button>
          )}
        </div>
      </header>

      <ChartPreview proposal={proposal} />

      {error ? (
        <p role="alert" className={styles.errorMessage}>
          {error}
        </p>
      ) : null}

      {applyResult ? <ApplySummaryLine summary={applyResult} /> : null}
    </article>
  );
}

function ChartPreview({ proposal }: { proposal: ChartProposal }) {
  return (
    <>
      {proposal.top_seats.length > 0 ? (
        // Render the two seats hierarchically — the first (Visionary
        // / CEO) sits on top, the second (Integrator / COO) below and
        // connected with a vertical line. Mirrors the actual chart
        // layout where the second seat is a child of the first, not
        // a sibling.
        <div className={styles.topStack}>
          {proposal.top_seats.map((seat, i) => (
            <div key={seat.name} className={styles.topSeatWrap}>
              {i > 0 ? (
                <span
                  className={styles.topSeatConnector}
                  aria-hidden="true"
                />
              ) : null}
              <div
                className={
                  i === 0
                    ? styles.topSeat
                    : `${styles.topSeat} ${styles.topSeatChild}`
                }
              >
                <p className={styles.topSeatName}>{seat.name}</p>
                <p className={styles.topSeatNote}>{seat.note}</p>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className={styles.functionsGrid}>
        {proposal.functions.map((fn) => (
          <div key={fn.name} className={styles.functionCard}>
            <h4 className={styles.functionName}>{fn.name}</h4>
            <ul className={styles.responsibilityList}>
              {fn.responsibilities.map((r, i) => (
                <li
                  key={i}
                  className={
                    i === 0
                      ? `${styles.responsibility} ${styles.responsibilityLMA}`
                      : styles.responsibility
                  }
                >
                  {r}
                </li>
              ))}
            </ul>
            {fn.sub_functions && fn.sub_functions.length > 0 ? (
              <div className={styles.subFunctions}>
                {fn.sub_functions.map((sub) => (
                  <div key={sub.name} className={styles.subFunction}>
                    <h5 className={styles.subFunctionName}>{sub.name}</h5>
                    <ul className={styles.responsibilityList}>
                      {sub.responsibilities.map((r, i) => (
                        <li
                          key={i}
                          className={
                            i === 0
                              ? `${styles.responsibility} ${styles.responsibilityLMA}`
                              : styles.responsibility
                          }
                        >
                          {r}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </>
  );
}

function ApplySummaryLine({ summary }: { summary: ApplySummary }) {
  const parts: string[] = [];
  if (summary.totalCreatedFunctions > 0) {
    parts.push(
      `Created ${summary.totalCreatedFunctions} new function${summary.totalCreatedFunctions === 1 ? "" : "s"}: ${summary.createdFunctions.join(", ")}.`
    );
  }
  if (summary.createdSubFunctions.length > 0) {
    parts.push(
      `Added sub-function${summary.createdSubFunctions.length === 1 ? "" : "s"}: ${summary.createdSubFunctions.join(", ")}.`
    );
  }
  const mergeAdditions = summary.addedResponsibilitiesByFunction.filter(
    (m) => !summary.createdFunctions.includes(m.function)
  );
  if (mergeAdditions.length > 0 && summary.totalAddedResponsibilities > 0) {
    const total = mergeAdditions.reduce((s, m) => s + m.count, 0);
    if (total > 0) {
      const breakdown = mergeAdditions
        .map((m) => `${m.count} to ${m.function}`)
        .join(", ");
      parts.push(
        `Added ${total} new responsibilit${total === 1 ? "y" : "ies"} to existing functions: ${breakdown}.`
      );
    }
  }
  if (summary.renamedTopSeats.length > 0) {
    const renames = summary.renamedTopSeats
      .map((r) => `${r.from} → ${r.to}`)
      .join(", ");
    parts.push(`Renamed your top seats: ${renames}.`);
  }
  if (summary.reparentedFunctions.length > 0) {
    parts.push(
      `Moved ${summary.reparentedFunctions.join(", ")} under the operator seat.`
    );
  }
  if (
    summary.renamedTopSeats.length === 0 &&
    summary.keptTopSeats.length > 0
  ) {
    const kept = summary.keptTopSeats.join(", ");
    const proposed = summary.proposedTopSeats.join(", ");
    parts.push(
      `Kept your existing top seats: ${kept}. The proposal called them ${proposed} — rename yours if you prefer.`
    );
  }
  if (parts.length === 0) {
    parts.push("Nothing new to add — your chart already covered everything in the proposal.");
  }
  return (
    <div className={styles.summaryLine} role="status">
      {parts.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </div>
  );
}
