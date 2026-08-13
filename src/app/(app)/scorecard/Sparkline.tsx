// Hand-rolled SVG sparkline. Renders a small line over 0–10, plus a
// dot on the most recent point. Nulls are treated as gaps (line
// segments skip them) so a feature-was-off period shows as a break
// rather than a fake zero line.
//
// No chart library — a sparkline is 40 lines of SVG and pulling
// Recharts for this would be more infrastructure than the widget.

type Point = { x: string; y: number | null };

export function Sparkline({
  points,
  width,
  height,
  ariaLabel,
}: {
  points: Point[];
  width: number;
  height: number;
  ariaLabel: string;
}) {
  if (points.length === 0) {
    return (
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={ariaLabel}
        style={{ display: "block" }}
      >
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="var(--aims-line-muted, #d4d4d8)"
          strokeDasharray="2 3"
        />
      </svg>
    );
  }

  const pad = 2;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const step = points.length > 1 ? innerW / (points.length - 1) : 0;
  const yFor = (v: number) => pad + innerH * (1 - Math.max(0, Math.min(10, v)) / 10);

  // Build a path with gaps for null values. Each contiguous run of
  // non-null points becomes its own M…L subpath so the line breaks
  // cleanly across gaps instead of drawing across the missing weeks.
  const segments: string[] = [];
  let current: string[] = [];
  points.forEach((p, i) => {
    const x = pad + step * i;
    if (p.y === null) {
      if (current.length > 0) {
        segments.push(current.join(" "));
        current = [];
      }
      return;
    }
    const y = yFor(p.y);
    if (current.length === 0) {
      current.push(`M ${x.toFixed(1)} ${y.toFixed(1)}`);
    } else {
      current.push(`L ${x.toFixed(1)} ${y.toFixed(1)}`);
    }
  });
  if (current.length > 0) segments.push(current.join(" "));

  // Most recent point dot (skip if null).
  const last = points[points.length - 1];
  const lastX = pad + step * (points.length - 1);
  const lastY = last.y === null ? null : yFor(last.y);

  return (
    <svg
      width={width}
      height={height}
      role="img"
      aria-label={ariaLabel}
      style={{ display: "block" }}
    >
      {/* 5-line grid at 5/10 to give the sparkline a scale reference. */}
      <line
        x1={0}
        y1={yFor(5)}
        x2={width}
        y2={yFor(5)}
        stroke="var(--aims-line-muted, #e4e4e7)"
        strokeDasharray="1 3"
        strokeWidth={1}
      />
      {segments.map((d, i) => (
        <path
          key={i}
          d={d}
          fill="none"
          stroke="var(--aims-brand, #4f46e5)"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {lastY !== null ? (
        <circle
          cx={lastX}
          cy={lastY}
          r={2.5}
          fill="var(--aims-brand, #4f46e5)"
        />
      ) : null}
    </svg>
  );
}
