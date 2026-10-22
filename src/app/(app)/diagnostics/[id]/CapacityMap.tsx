import type { MapPoint } from "@/lib/diagnostics/hours-back";
import { formatHours } from "@/lib/diagnostics/hours-back";
import { MAP, layoutMap, xFor, yFor } from "@/lib/diagnostics/map-layout";
import styles from "../diagnostics.module.css";

// The Capacity Map: a two-by-two of energy and judgment, every task a
// dot sized by its hours. A filled dot is volume-checked hours; a
// hollow one is the person's own estimate. The shaded corner is the
// candidates: draining and routine. Drawn inline from hours-back.ts's
// output, in the theme's colours.
export function CapacityMap({ points }: { points: MapPoint[] }) {
  const dots = layoutMap(points);
  const x0 = xFor(0.5), x25 = xFor(2.5), x55 = xFor(5.5);
  const y0 = yFor(0.5), y25 = yFor(2.5), y55 = yFor(5.5);
  return (
    <figure className={styles.mapFigure}>
      <svg viewBox={`0 0 ${MAP.width} ${MAP.height}`} className={styles.map} role="img" aria-label={`Capacity Map: ${points.length} tasks by energy and judgment`}>
        <rect x={x0} y={y25} width={x25 - x0} height={y0 - y25} className={styles.mapQuadrant} />
        <rect x={x0} y={y55} width={x55 - x0} height={y0 - y55} className={styles.mapFrame} />
        <line x1={xFor(3)} x2={xFor(3)} y1={y55} y2={y0} className={styles.mapFrame} strokeDasharray="4 4" />
        <line x1={x0} x2={x55} y1={yFor(3)} y2={yFor(3)} className={styles.mapFrame} strokeDasharray="4 4" />
        <text x={x0 + 8} y={y0 - 8} className={styles.mapLabel}>
          Candidates
        </text>
        {[1, 2, 3, 4, 5].map((n) => (
          <g key={n}>
            <text x={xFor(n)} y={y0 + 18} textAnchor="middle" className={styles.mapAxis}>
              {n}
            </text>
            <text x={x0 - 10} y={yFor(n) + 4} textAnchor="end" className={styles.mapAxis}>
              {n}
            </text>
          </g>
        ))}
        <text x={x0} y={MAP.height - 6} className={styles.mapAxis}>
          Drains me
        </text>
        <text x={x55} y={MAP.height - 6} textAnchor="end" className={styles.mapAxis}>
          Energizes me
        </text>
        <text x={14} y={y0} transform={`rotate(-90 14 ${y0})`} className={styles.mapAxis}>
          Routine
        </text>
        <text x={14} y={y55} transform={`rotate(-90 14 ${y55})`} textAnchor="end" className={styles.mapAxis}>
          Needs experience
        </text>
        {dots.map((d) => (
          <circle key={d.taskId} cx={d.cx} cy={d.cy} r={d.r} className={d.checked ? styles.dotChecked : styles.dotEstimate} data-testid="map-dot">
            {/* One string: React wants a title's children as a single text node. */}
            <title>{`${d.title}: ${formatHours(d.hours)} hours a week, ${d.checked ? "checked" : "estimated"}`}</title>
          </circle>
        ))}
      </svg>
      <figcaption className={styles.legend}>
        <span>
          <span className={`${styles.legendDot} ${styles.legendFilled}`} aria-hidden="true" />
          Checked hours
        </span>
        <span>
          <span className={styles.legendDot} aria-hidden="true" />
          Estimated hours
        </span>
        <span>Dot size is hours a week</span>
      </figcaption>
    </figure>
  );
}
