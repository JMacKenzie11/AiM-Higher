import styles from "./dashboard.module.css";

// Simple SVG area sparkline. Server-renderable (no interactivity)
// — takes raw values, draws a filled path with a matching stroke
// on top. Height + width are fixed via CSS on .sparkline; the SVG
// scales via viewBox.
//
// A single-value or all-zero input renders a flat baseline so the
// card doesn't collapse or draw a divide-by-zero NaN path.

export function Sparkline({
  points,
  ariaLabel,
}: {
  points: number[];
  ariaLabel: string;
}) {
  const width = 100;
  const height = 30;
  const n = points.length;
  if (n === 0) {
    return (
      <svg
        className={styles.sparkline}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={ariaLabel}
      >
        <line
          x1={0}
          y1={height - 1}
          x2={width}
          y2={height - 1}
          stroke="currentColor"
          strokeWidth={0.75}
          opacity={0.25}
        />
      </svg>
    );
  }
  const max = Math.max(...points, 1);
  const step = n > 1 ? width / (n - 1) : 0;
  const coords = points.map((v, i) => {
    const x = i * step;
    // Reserve a 2px baseline so a zero doesn't render on the edge.
    const y = height - 2 - (v / max) * (height - 4);
    return [x, y] as const;
  });

  const linePath = coords
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(" ");
  const areaPath = `${linePath} L${width} ${height} L0 ${height} Z`;

  return (
    <svg
      className={styles.sparkline}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaLabel}
    >
      <defs>
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#spark-fill)" />
      <path
        d={linePath}
        fill="none"
        stroke="var(--primary)"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
