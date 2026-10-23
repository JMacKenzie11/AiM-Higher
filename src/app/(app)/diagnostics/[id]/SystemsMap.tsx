import { SYSTEMS_MAP, layoutSystemsMap } from "@/lib/diagnostics/systems-map-layout";
import type { Connection, SnapshotSystem } from "@/lib/diagnostics/systems-snapshot";
import styles from "../diagnostics.module.css";

// The systems map (phase 4): one box per system, one arrow per way
// information moves. An automatic connection is thin and quiet; one
// typed in again or exported and imported is heavier, in the warning
// accent, and labelled with the hours a week it carries. Drawn inline
// from systems-snapshot.ts's output, in the theme's colours.
export function SystemsMap({ systems, connections }: { systems: SnapshotSystem[]; connections: Connection[] }) {
  const { boxes, arrows } = layoutSystemsMap(systems, connections);
  return (
    <figure className={styles.mapFigure}>
      <svg
        viewBox={`0 0 ${SYSTEMS_MAP.width} ${SYSTEMS_MAP.height}`}
        className={styles.map}
        role="img"
        aria-label={`Systems map: ${systems.length} systems and ${connections.length} ways information moves between them`}
      >
        <defs>
          <marker id="sys-arrow-quiet" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className={styles.arrowHeadQuiet} />
          </marker>
          <marker id="sys-arrow-hand" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className={styles.arrowHeadHand} />
          </marker>
        </defs>
        {arrows.map((a) => (
          <g key={a.key} data-testid="system-arrow">
            <line
              x1={a.x1}
              y1={a.y1}
              x2={a.x2}
              y2={a.y2}
              className={a.handCarried ? styles.arrowHand : styles.arrowQuiet}
              markerEnd={`url(#${a.handCarried ? "sys-arrow-hand" : "sys-arrow-quiet"})`}
            >
              <title>{a.title}</title>
            </line>
            {a.label ? (
              <text x={a.lx} y={a.ly} textAnchor="middle" className={styles.arrowLabel}>
                {a.label}
              </text>
            ) : null}
          </g>
        ))}
        {boxes.map((b) => (
          <g key={b.id}>
            <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={6} className={styles.systemBox} />
            <text x={b.x + b.w / 2} y={b.y + 20} textAnchor="middle" className={styles.mapLabel}>
              {b.name.length > 20 ? `${b.name.slice(0, 19)}…` : b.name}
            </text>
            <text x={b.x + b.w / 2} y={b.y + 36} textAnchor="middle" className={styles.mapAxis}>
              {b.kindLabel}
            </text>
          </g>
        ))}
      </svg>
      <figcaption className={styles.legend}>
        <span>
          <span className={`${styles.legendLine} ${styles.legendHand}`} aria-hidden="true" />
          Typed in again, or exported and imported
        </span>
        <span>
          <span className={styles.legendLine} aria-hidden="true" />
          Connected automatically, or not sure
        </span>
      </figcaption>
    </figure>
  );
}
