import styles from "./KeepRateBarChart.module.css";
import { formatShortDate } from "@/lib/dates";

// 12-week keep-rate bar chart — Section 8.2 / 8.6.
//   • One bar per week_ending.
//   • Cobalt bars with rounded tops, current week in sky.
//   • Percent labeled directly above each bar (tabular-nums).
//   • No y-axis gridlines; week labels beneath in caption style.
//   • Fill animates once on load via CSS transform.
// Rendered as a pure server component using CSS grid — no external
// chart library, no client-side JS.

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
    </div>
  );
}
