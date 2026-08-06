"use client";

import { useMemo } from "react";
import type { BoardData, BoardFunction, BoardStatus } from "@/lib/measures/board";
import styles from "./board.module.css";

// View A — one card per function, ranked "worst first". Inside
// each card, a compact metric × week heatmap with dot-cells coloured
// by status against target. Cards stagger-fade in on load so the
// board feels alive rather than server-rendered stone.

export function CockpitGrid({ data }: { data: BoardData }) {
  const sorted = useMemo(() => rankFunctions(data), [data]);

  return (
    <div className={styles.cockpitGrid}>
      {sorted.map((fn, idx) => (
        <FunctionCard
          key={fn.id}
          fn={fn}
          weeks={data.weeks}
          animationDelay={idx * 60}
        />
      ))}
    </div>
  );
}

function FunctionCard({
  fn,
  weeks,
  animationDelay,
}: {
  fn: BoardFunction;
  weeks: string[];
  animationDelay: number;
}) {
  const summary = summarizeFunction(fn, weeks.length - 1);
  const healthPct = summary.eligible > 0
    ? Math.round((summary.good / summary.eligible) * 100)
    : null;

  return (
    <article
      className={styles.cockpitCard}
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      <header className={styles.cockpitCardHeader}>
        <div>
          <h3 className={styles.cockpitCardTitle}>{fn.title}</h3>
          <p className={styles.cockpitCardSeat}>
            {fn.seatHolder ? `In the seat: ${fn.seatHolder}` : "Seat unassigned"}
          </p>
        </div>
        <div className={styles.cockpitCardHealth}>
          {summary.eligible > 0 ? (
            <>
              <span
                className={`${styles.cockpitCardHealthNumber} ${styles[`cockpitCardHealthNumber_${healthTone(healthPct)}`]}`}
              >
                {healthPct}%
              </span>
              <span className={styles.cockpitCardHealthLabel}>
                {summary.good} of {summary.eligible} on target
              </span>
            </>
          ) : (
            <span className={styles.cockpitCardHealthMuted}>No targets set</span>
          )}
        </div>
      </header>

      {fn.metrics.length === 0 ? (
        <p className={styles.cockpitCardEmpty}>No metrics on this function yet.</p>
      ) : (
        <div className={styles.cockpitMetricList}>
          {fn.metrics.map((m) => (
            <div key={m.id} className={styles.cockpitMetricRow}>
              <div className={styles.cockpitMetricLabel}>
                <span className={styles.cockpitMetricName}>{m.description}</span>
                <span className={styles.cockpitMetricTarget}>
                  {m.target ? (
                    <>
                      {m.direction === "higher_is_better" ? "≥" : "≤"} {m.target}
                    </>
                  ) : (
                    "No target"
                  )}
                </span>
              </div>
              <div className={styles.cockpitCellRow}>
                {m.cells.map((c) => (
                  <span
                    key={c.weekEnding}
                    className={`${styles.cockpitCell} ${styles[`cockpitCell_${c.status}`]}`}
                    title={`Week of ${c.weekEnding} · ${c.displayValue}${
                      m.target ? ` · target ${m.target}` : ""
                    }`}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function healthTone(pct: number | null): "good" | "off" | "warn" {
  if (pct == null) return "warn";
  if (pct >= 80) return "good";
  if (pct >= 50) return "warn";
  return "off";
}

function summarizeFunction(fn: BoardFunction, currentIdx: number) {
  let good = 0;
  let off = 0;
  let unlogged = 0;
  let eligible = 0;
  for (const m of fn.metrics) {
    const cell = m.cells[currentIdx];
    if (!cell || cell.status === "no_target") continue;
    eligible += 1;
    if (cell.status === "good") good += 1;
    else if (cell.status === "off") off += 1;
    else if (cell.status === "unlogged") unlogged += 1;
  }
  return { good, off, unlogged, eligible };
}

// Rank order: functions with any off metrics this week come first
// (worst first), then those with unlogged, then everything on
// target. Ties within a bucket fall back to sort_order (already
// applied server-side) via the natural array order.
function rankFunctions(data: BoardData): BoardFunction[] {
  const currentIdx = data.weeks.length - 1;
  const scored = data.functions.map((fn) => {
    const s = summarizeFunction(fn, currentIdx);
    // Higher score = worse; float to top.
    const score = s.off * 1000 + s.unlogged * 10 - s.good;
    return { fn, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.fn);
}

// Re-export the type so consumers importing from this file don't
// have to reach into ../board to pull it separately.
export type { BoardStatus };
