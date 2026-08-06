"use client";

import { useMemo } from "react";
import type {
  BoardData,
  BoardFunction,
  BoardMetric,
  BoardStatus,
} from "@/lib/measures/board";
import styles from "./board.module.css";

// View A — one card per function, ranked so leadership seats
// (Visionary → Integrator) sit at the top and everything else falls
// in "worst first" order below. Inside each card, one sparkline per
// metric with a dashed target line, coloured markers at each week
// (green hit, red miss, hollow gap for missing), and a "now" marker
// pinned to the last column so the current-week health number and
// the chart line up visually.

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
  const healthPct =
    summary.eligible > 0
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
                {summary.good} of {summary.eligible} on target this week
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
          {fn.metrics.map((m, mIdx) => (
            <MetricSparklineRow
              key={m.id}
              metric={m}
              animationDelay={animationDelay + 120 + mIdx * 80}
            />
          ))}
        </div>
      )}
    </article>
  );
}

function MetricSparklineRow({
  metric,
  animationDelay,
}: {
  metric: BoardMetric;
  animationDelay: number;
}) {
  const currentCell = metric.cells[metric.cells.length - 1];
  const currentStatus = currentCell?.status ?? "unlogged";
  return (
    <div className={styles.sparkRow}>
      <div className={styles.sparkLabel}>
        <span className={styles.sparkName} title={metric.description}>
          {metric.description}
        </span>
        <span className={styles.sparkTarget}>
          {metric.target ? (
            <>
              {metric.direction === "higher_is_better" ? "≥" : "≤"} {metric.target}
              {" · "}
              <span
                className={`${styles.sparkNowChip} ${styles[`sparkNowChip_${currentStatus}`]}`}
                title={
                  currentCell
                    ? `Week of ${currentCell.weekEnding} · ${currentCell.displayValue}`
                    : "Nothing logged this week"
                }
              >
                now {currentCell?.displayValue ?? "—"}
              </span>
            </>
          ) : (
            <span className={styles.sparkNoTarget}>No target</span>
          )}
        </span>
      </div>
      <div className={styles.sparkChart}>
        <Sparkline metric={metric} animationDelay={animationDelay} />
      </div>
    </div>
  );
}

// SVG viewBox in unitless "sparkline units". CSS scales the SVG to
// its container. width:height ratio is intentional (5:1) — wide and
// short reads as a trend, not a chart.
const SPARK_W = 200;
const SPARK_H = 40;
const SPARK_PAD = { top: 4, right: 4, bottom: 4, left: 4 };

function Sparkline({
  metric,
  animationDelay,
}: {
  metric: BoardMetric;
  animationDelay: number;
}) {
  const { cells, targetNumeric } = metric;
  const innerW = SPARK_W - SPARK_PAD.left - SPARK_PAD.right;
  const innerH = SPARK_H - SPARK_PAD.top - SPARK_PAD.bottom;

  // Y scale — include every non-null value and the target, then pad
  // 10% on both sides so the target line doesn't sit right on the
  // edge and the line has breathing room.
  const values = cells
    .map((c) => c.numericValue)
    .filter((v): v is number => v != null);
  const references = targetNumeric != null ? [targetNumeric, ...values] : values;
  let min = references.length > 0 ? Math.min(...references) : 0;
  let max = references.length > 0 ? Math.max(...references) : 1;
  if (min === max) {
    // Constant series or single point — spread the axis so the line
    // renders in the middle rather than pinned to an edge.
    min = min - 1;
    max = max + 1;
  }
  const span = max - min;
  const pad = span * 0.15;
  min -= pad;
  max += pad;

  const xFor = (i: number) =>
    SPARK_PAD.left + (cells.length <= 1 ? innerW / 2 : (i / (cells.length - 1)) * innerW);
  const yFor = (value: number) =>
    SPARK_PAD.top + innerH - ((value - min) / (max - min)) * innerH;

  const targetY = targetNumeric != null ? yFor(targetNumeric) : null;

  // Build a path that breaks at nulls — a missed week reads as a
  // gap rather than a straight-line interpolation.
  const segments: string[] = [];
  let currentSeg: string[] = [];
  cells.forEach((c, i) => {
    if (c.numericValue == null) {
      if (currentSeg.length > 0) {
        segments.push(currentSeg.join(" "));
        currentSeg = [];
      }
      return;
    }
    const cmd = currentSeg.length === 0 ? "M" : "L";
    currentSeg.push(`${cmd}${xFor(i).toFixed(2)},${yFor(c.numericValue).toFixed(2)}`);
  });
  if (currentSeg.length > 0) segments.push(currentSeg.join(" "));
  const path = segments.join(" ");

  const currentIdx = cells.length - 1;
  const currentCell = cells[currentIdx];
  const currentX = xFor(currentIdx);

  return (
    <svg
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      className={styles.sparkSvg}
      preserveAspectRatio="none"
      role="img"
      aria-label={`13-week trend for ${metric.description}`}
    >
      {targetY != null ? (
        <>
          <line
            x1={0}
            x2={SPARK_W}
            y1={targetY}
            y2={targetY}
            className={styles.sparkTargetLine}
          />
          <text
            x={SPARK_W - 2}
            y={targetY - 2}
            className={styles.sparkTargetLabel}
            textAnchor="end"
          >
            target
          </text>
        </>
      ) : null}

      {/* "Now" vertical guide — anchors the eye to the current
          week so the health number and the chart line up. */}
      <line
        x1={currentX}
        x2={currentX}
        y1={SPARK_PAD.top - 1}
        y2={SPARK_H - SPARK_PAD.bottom + 1}
        className={styles.sparkNowLine}
      />

      {path.length > 0 ? (
        <path
          d={path}
          className={styles.sparkPath}
          style={{ animationDelay: `${animationDelay}ms` }}
        />
      ) : null}

      {cells.map((c, i) => {
        if (c.numericValue == null) return null;
        const isCurrent = i === currentIdx;
        return (
          <circle
            key={c.weekEnding}
            cx={xFor(i)}
            cy={yFor(c.numericValue)}
            r={isCurrent ? 4 : 2.4}
            className={`${styles.sparkDot} ${styles[`sparkDot_${c.status}`]}${
              isCurrent ? ` ${styles.sparkDotCurrent}` : ""
            }`}
            style={{
              animationDelay: `${animationDelay + 300 + i * 30}ms`,
            }}
          >
            <title>
              Week of {c.weekEnding} · {c.displayValue}
            </title>
          </circle>
        );
      })}
    </svg>
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

// Sort key: (depth ASC, score DESC). Leadership seats — Visionary
// (depth 0) and Integrator (depth 1) — always come first. Within
// the same depth, worse current-week performance floats to the top.
function rankFunctions(data: BoardData): BoardFunction[] {
  const currentIdx = data.weeks.length - 1;
  const scored = data.functions.map((fn) => {
    const s = summarizeFunction(fn, currentIdx);
    const score = s.off * 1000 + s.unlogged * 10 - s.good;
    return { fn, score };
  });
  scored.sort((a, b) => {
    if (a.fn.depth !== b.fn.depth) return a.fn.depth - b.fn.depth;
    return b.score - a.score;
  });
  return scored.map((s) => s.fn);
}

export type { BoardStatus };
