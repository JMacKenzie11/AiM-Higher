"use client";

import { useMemo } from "react";
import type {
  BoardData,
  BoardFunction,
  BoardStatus,
} from "@/lib/measures/board";
import styles from "./board.module.css";

// View C — one row per function, 13 columns of weeks. Each cell
// rolls up all that function's metrics for that week into one
// status. Hover a cell to see the breakdown. Reads like a Gantt:
// patterns across time jump out ("Sales lost focus in weeks 4–6").

type RollupStatus = BoardStatus | "mixed";

type RollupCell = {
  weekEnding: string;
  status: RollupStatus;
  good: number;
  off: number;
  unlogged: number;
  total: number;
};

export function StoryTimeline({ data }: { data: BoardData }) {
  const rolledUp = useMemo(() => rollUpFunctions(data), [data]);

  return (
    <div className={styles.timelineScroll}>
      <div
        className={styles.timelineGrid}
        style={{
          gridTemplateColumns: `minmax(200px, 220px) repeat(${data.weeks.length}, minmax(28px, 1fr))`,
        }}
      >
        <div className={styles.timelineCornerCell} aria-hidden />
        {data.weeks.map((w, idx) => (
          <div key={w} className={styles.timelineHeaderCell}>
            <span className={styles.timelineHeaderWeek}>{formatShort(w)}</span>
            {idx === data.weeks.length - 1 ? (
              <span className={styles.timelineHeaderNow}>now</span>
            ) : null}
          </div>
        ))}

        {rolledUp.map((row, rowIdx) => (
          <FunctionRow
            key={row.fn.id}
            row={row}
            animationDelay={rowIdx * 50}
          />
        ))}
      </div>

      <div className={styles.timelineLegend}>
        <LegendChip tone="good" label="All on target" />
        <LegendChip tone="off" label="At least one missed" />
        <LegendChip tone="mixed" label="Mixed / partial log" />
        <LegendChip tone="unlogged" label="Nothing logged" />
        <LegendChip tone="no_target" label="No targets set" />
      </div>
    </div>
  );
}

function FunctionRow({
  row,
  animationDelay,
}: {
  row: { fn: BoardFunction; cells: RollupCell[] };
  animationDelay: number;
}) {
  return (
    <>
      <div
        className={styles.timelineFunctionCell}
        style={{ animationDelay: `${animationDelay}ms` }}
      >
        <span className={styles.timelineFunctionName}>{row.fn.title}</span>
        <span className={styles.timelineFunctionSeat}>
          {row.fn.seatHolder ?? "Unassigned"}
        </span>
      </div>
      {row.cells.map((cell) => (
        <div
          key={cell.weekEnding}
          className={`${styles.timelineDataCell} ${styles[`timelineDataCell_${cell.status}`]}`}
          style={{ animationDelay: `${animationDelay + 40}ms` }}
          title={tooltipFor(cell)}
        />
      ))}
    </>
  );
}

function LegendChip({
  tone,
  label,
}: {
  tone: RollupStatus;
  label: string;
}) {
  return (
    <span className={styles.timelineLegendChip}>
      <span
        className={`${styles.timelineLegendSwatch} ${styles[`timelineLegendSwatch_${tone}`]}`}
      />
      {label}
    </span>
  );
}

function rollUpFunctions(
  data: BoardData
): Array<{ fn: BoardFunction; cells: RollupCell[] }> {
  return data.functions.map((fn) => ({
    fn,
    cells: data.weeks.map((w, idx) => {
      let good = 0;
      let off = 0;
      let unlogged = 0;
      let total = 0;
      for (const m of fn.metrics) {
        const c = m.cells[idx];
        if (!c || c.status === "no_target") continue;
        total += 1;
        if (c.status === "good") good += 1;
        else if (c.status === "off") off += 1;
        else if (c.status === "unlogged") unlogged += 1;
      }
      let status: RollupStatus;
      if (total === 0) {
        status = fn.metrics.length > 0 ? "no_target" : "no_target";
      } else if (off > 0) {
        status = "off";
      } else if (unlogged === total) {
        status = "unlogged";
      } else if (good === total) {
        status = "good";
      } else {
        status = "mixed";
      }
      return { weekEnding: w, status, good, off, unlogged, total };
    }),
  }));
}

function tooltipFor(cell: RollupCell): string {
  if (cell.total === 0) return `Week of ${cell.weekEnding} · no targets set`;
  const parts: string[] = [];
  if (cell.good > 0) parts.push(`${cell.good} on target`);
  if (cell.off > 0) parts.push(`${cell.off} off`);
  if (cell.unlogged > 0) parts.push(`${cell.unlogged} not logged`);
  return `Week of ${cell.weekEnding} · ${parts.join(", ")}`;
}

function formatShort(iso: string): string {
  // "M/D" format for a compact column header. The full ISO date
  // sits in each cell tooltip so precision isn't lost.
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}
