import styles from "./KeepRateBarChart.module.css";
import { formatShortDate } from "@/lib/dates";

// 12-week follow-through-rate bar chart — Section 8.2 / 8.6.
//   • One bar per week_ending.
//   • Cobalt bars with rounded tops, current week in sky.
//   • Dashed cobalt trend line via linear regression on non-null weeks.
//   • Percent labeled directly above each bar (tabular-nums).
//   • Week labels beneath in caption style; no y-axis gridlines.
//   • Bar fill animates once on load; trend line draws in on load.
// Rendered as a pure server component using CSS grid + a single SVG
// overlay — no external chart library, no client-side JS.

export type KeepRateBar = {
  weekEnding: string;
  keepRate: number | null; // 0-100
  isCurrentWeek: boolean;
};

export function KeepRateBarChart({
  bars,
  ariaLabel = "Follow-through rate by week",
}: {
  bars: KeepRateBar[];
  ariaLabel?: string;
}) {
  if (bars.length === 0) {
    return (
      <p className={styles.empty}>
        No commitments resolved yet — the trend chart fills in as weeks land.
      </p>
    );
  }

  const hasAnyData = bars.some((bar) => bar.keepRate !== null);
  if (!hasAnyData) {
    return (
      <p className={styles.empty}>
        No commitments resolved yet — the trend chart fills in as weeks land.
      </p>
    );
  }

  const trend = computeTrendLine(bars);

  return (
    <div
      className={styles.chart}
      role="img"
      aria-label={ariaLabel}
      style={{ ["--bar-count" as string]: bars.length }}
    >
      {bars.map((bar) => {
        const isEmpty = bar.keepRate === null;
        const heightPct = isEmpty ? 0 : Math.max(4, bar.keepRate ?? 0);
        return (
          <div key={bar.weekEnding} className={styles.column}>
            <span className={styles.value}>
              {isEmpty ? "—" : `${bar.keepRate}%`}
            </span>
            <div className={styles.track} aria-hidden="true">
              <span
                className={
                  bar.isCurrentWeek ? styles.barCurrent : styles.bar
                }
                style={{ height: `${heightPct}%` }}
              />
            </div>
            <span className={styles.label}>{formatShortDate(bar.weekEnding)}</span>
          </div>
        );
      })}

      {trend ? (
        // Overlay SVG sits on top of every .track (see .trendLayer CSS
        // for positioning). Coordinates are percentage-based; y is
        // inverted because SVG's origin is top-left.
        <svg
          className={styles.trendLayer}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <line
            x1={trend.x1}
            y1={100 - trend.y1}
            x2={trend.x2}
            y2={100 - trend.y2}
            className={styles.trendLine}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      ) : null}
    </div>
  );
}

// ---------- linear regression ----------

// Compute a simple least-squares regression over the weeks that have
// resolved commitments. Returns line endpoints in percentage space
// (x: 0–100 across the bar strip; y: 0–100 of the track height).
// Returns null when we have fewer than 2 data points (a line through
// one point would be meaningless).
function computeTrendLine(bars: KeepRateBar[]) {
  const points: Array<{ i: number; y: number }> = [];
  for (const [i, bar] of bars.entries()) {
    if (bar.keepRate === null) continue;
    points.push({ i, y: bar.keepRate });
  }
  if (points.length < 2) return null;

  const n = points.length;
  const sumX = points.reduce((s, p) => s + p.i, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.i * p.y, 0);
  const sumX2 = points.reduce((s, p) => s + p.i * p.i, 0);

  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return null; // all x values equal (impossible here)

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  const barCount = bars.length;
  const firstX = 0;
  const lastX = barCount - 1;
  const firstY = clamp(slope * firstX + intercept, 0, 100);
  const lastY = clamp(slope * lastX + intercept, 0, 100);

  // Convert from bar-index space to percent-of-strip space. Each bar's
  // center sits at (i + 0.5) / barCount. Extending to bar edges (0 and
  // 1 for the last one) ties the line to the same visual field the
  // bars occupy.
  return {
    x1: ((firstX + 0.5) / barCount) * 100,
    y1: firstY,
    x2: ((lastX + 0.5) / barCount) * 100,
    y2: lastY,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
