import { CardAccent } from "@/components/ui/CardAccent";
import type {
  MeasureCardItem,
  MeasureInsights,
} from "@/lib/measures/insights";
import styles from "./dashboard.module.css";

// Four generative operational-performance cards. Only cards with
// content render — an empty quarter shows nothing, which is the
// right message ("nothing to celebrate yet, nothing to worry about
// yet"). Cards intentionally look identical in structure so the eye
// can compare across them.
//
// Two of the cards get bespoke graphical treatments:
//   * Gaining ground — sparkline of the trend window + delta chip
//   * Wins this week — target-vs-actual meter with a check badge
// Both reveal with a staggered CSS animation so the dashboard feels
// alive on load. The other two cards keep the plain list format so
// the eye doesn't have to work as hard.

export function MeasureInsightsCards({
  insights,
}: {
  insights: MeasureInsights;
}) {
  const anyContent =
    insights.gainingGround.length > 0 ||
    insights.streaks.length > 0 ||
    insights.winsThisWeek.length > 0 ||
    insights.worthAConversation.length > 0;
  if (!anyContent) return null;

  return (
    <>
      {insights.gainingGround.length > 0 ? (
        <GainingGroundCard items={insights.gainingGround} />
      ) : null}
      {insights.winsThisWeek.length > 0 ? (
        <WinsThisWeekCard items={insights.winsThisWeek} />
      ) : null}
      {insights.streaks.length > 0 ? (
        <MeasureCard
          heading="Streaks in flight"
          meta="At or above target for 3+ consecutive weeks."
          items={insights.streaks}
          tone="positive"
        />
      ) : null}
      {insights.worthAConversation.length > 0 ? (
        <MeasureCard
          heading="Where a conversation could help"
          meta="Measures that have dipped over the last 3 weeks. Worth exploring what changed together."
          items={insights.worthAConversation}
          tone="amber"
        />
      ) : null}
    </>
  );
}

// ---------- Gaining ground ----------

function GainingGroundCard({ items }: { items: MeasureCardItem[] }) {
  const headingId = "gaining-ground";
  return (
    <section className={styles.cardAccent} aria-labelledby={headingId}>
      <CardAccent />
      <h2 id={headingId} className={styles.h2}>
        Gaining ground this quarter
      </h2>
      <p className={styles.cardMeta}>
        Measures moving in the right direction across the last 6 weeks.
      </p>
      <ul className={styles.trendList}>
        {items.map((item, index) => (
          <li
            key={item.measureId}
            className={styles.trendRow}
            style={{ ["--i" as string]: String(index) }}
          >
            <div className={styles.trendText}>
              <div className={styles.trendTitle}>{item.description}</div>
              <div className={styles.trendMeta}>{item.functionTitle}</div>
            </div>
            <Sparkline
              points={item.sparkline}
              direction={item.targetDirection}
              indexInList={index}
            />
            <DeltaChip item={item} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function DeltaChip({ item }: { item: MeasureCardItem }) {
  const points = item.sparkline;
  if (points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const rawDelta = last - first;
  const higherIsBetter = item.targetDirection === "higher_is_better";
  const improved = higherIsBetter ? rawDelta > 0 : rawDelta < 0;
  const magnitude = Math.abs(rawDelta);
  const display = magnitude >= 10 ? magnitude.toFixed(0) : magnitude.toFixed(1);
  return (
    <span
      className={`${styles.deltaChip} ${improved ? styles.deltaChipUp : styles.deltaChipDown}`}
      aria-label={improved ? `Up ${display}` : `Down ${display}`}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 10 10"
        width={10}
        height={10}
        className={styles.deltaChipArrow}
      >
        <path
          d={improved ? "M5 1 L9 8 L1 8 Z" : "M5 9 L1 2 L9 2 Z"}
          fill="currentColor"
        />
      </svg>
      {higherIsBetter ? "+" : "−"}
      {display}
    </span>
  );
}

function Sparkline({
  points,
  direction,
  indexInList,
}: {
  points: number[];
  direction: MeasureCardItem["targetDirection"];
  indexInList: number;
}) {
  // Empty or single-point: render a placeholder so the layout doesn't
  // collapse and the row still reads as a set of columns.
  if (points.length < 2) {
    return <div className={styles.sparkline} aria-hidden="true" />;
  }

  const width = 140;
  const height = 44;
  const padX = 4;
  const padY = 6;
  const inner = { w: width - padX * 2, h: height - padY * 2 };

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;

  // Invert the Y-axis for "lower is better" so the sparkline always
  // visually rises when the measure is improving — that reinforces
  // the "gaining ground" story regardless of direction semantics.
  const higherIsBetter = direction === "higher_is_better";
  const toY = (v: number) => {
    const norm = (v - min) / range;
    const flipped = higherIsBetter ? 1 - norm : norm;
    return padY + flipped * inner.h;
  };
  const toX = (i: number) =>
    padX + (points.length === 1 ? inner.w / 2 : (i / (points.length - 1)) * inner.w);

  const coords = points.map((p, i) => ({ x: toX(i), y: toY(p) }));
  const linePath = coords
    .map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(2)} ${c.y.toFixed(2)}`)
    .join(" ");
  const areaPath =
    linePath +
    ` L${coords[coords.length - 1].x.toFixed(2)} ${(height - padY).toFixed(2)}` +
    ` L${coords[0].x.toFixed(2)} ${(height - padY).toFixed(2)} Z`;

  const gradId = `spark-fill-${indexInList}`;
  const lastPoint = coords[coords.length - 1];
  const strokeDelay = 120 + indexInList * 90;

  return (
    <svg
      className={styles.sparkline}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label="Trend across the last 6 weeks"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--aims-cobalt)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--aims-cobalt)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d={areaPath}
        fill={`url(#${gradId})`}
        className={styles.sparklineArea}
        style={{ ["--delay" as string]: `${strokeDelay + 200}ms` }}
      />
      <path
        d={linePath}
        fill="none"
        stroke="var(--aims-cobalt)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={styles.sparklineLine}
        style={{ ["--delay" as string]: `${strokeDelay}ms` }}
      />
      <circle
        cx={lastPoint.x}
        cy={lastPoint.y}
        r={3.2}
        fill="var(--aims-chartreuse)"
        stroke="var(--aims-navy)"
        strokeWidth={1}
        className={styles.sparklineDot}
        style={{ ["--delay" as string]: `${strokeDelay + 700}ms` }}
      />
    </svg>
  );
}

// ---------- Wins this week ----------

function WinsThisWeekCard({ items }: { items: MeasureCardItem[] }) {
  const headingId = "wins-this-week";
  return (
    <section className={styles.cardAccent} aria-labelledby={headingId}>
      <CardAccent />
      <h2 id={headingId} className={styles.h2}>
        Wins this week
      </h2>
      <p className={styles.cardMeta}>
        Measures that hit target for the week just ended.
      </p>
      <ul className={styles.winList}>
        {items.map((item, index) => (
          <li
            key={item.measureId}
            className={styles.winRow}
            style={{ ["--i" as string]: String(index) }}
          >
            <div className={styles.winBadge} aria-hidden="true">
              <svg viewBox="0 0 20 20" width={16} height={16}>
                <path
                  d="M4.5 10.5 L8.5 14.5 L15.5 6.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div className={styles.winText}>
              <div className={styles.winTitle}>{item.description}</div>
              <div className={styles.winMeta}>{item.functionTitle}</div>
              <TargetMeter item={item} indexInList={index} />
            </div>
            <div className={styles.winValueBlock}>
              <div className={styles.winValue}>{formatNumber(item.currentValue)}</div>
              {item.target ? (
                <div className={styles.winTargetLabel}>Target · {item.target}</div>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TargetMeter({
  item,
  indexInList,
}: {
  item: MeasureCardItem;
  indexInList: number;
}) {
  const value = item.currentValue;
  const target = item.targetNumber;
  if (value == null || target == null) {
    return <div className={styles.winMeterTrack} aria-hidden="true" />;
  }
  const higherIsBetter = item.targetDirection === "higher_is_better";
  // Layout: the meter always fills to at least the target position so
  // "hit target" reads visually. For higher-is-better, the target sits
  // at ~72% of the track so overshoots have room to extend past it;
  // for lower-is-better, target sits at ~72% and the achieved bar
  // matches or extends past that mark as we cap at the track width.
  const TARGET_POS = 72;
  let fillPct: number;
  if (higherIsBetter) {
    if (target <= 0) {
      fillPct = 100;
    } else {
      const ratio = value / target;
      fillPct = Math.min(TARGET_POS * ratio, 100);
    }
  } else {
    if (value <= 0) {
      fillPct = 100;
    } else {
      const ratio = target / value; // ≥1 when target is met (value ≤ target)
      fillPct = Math.min(TARGET_POS * ratio, 100);
    }
  }
  const delay = 200 + indexInList * 90;
  return (
    <div className={styles.winMeter}>
      <div className={styles.winMeterTrack} aria-hidden="true">
        <div
          className={styles.winMeterFill}
          style={{
            ["--fill" as string]: `${fillPct}%`,
            ["--delay" as string]: `${delay}ms`,
          }}
        />
        <div
          className={styles.winMeterTargetTick}
          style={{ ["--target-pos" as string]: `${TARGET_POS}%` }}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}

function formatNumber(v: number | null): string {
  if (v == null) return "—";
  if (Math.abs(v) >= 100 || Number.isInteger(v)) return v.toLocaleString();
  return v.toFixed(1);
}

// ---------- Generic list card (Streaks + Worth a conversation) ----------

function MeasureCard({
  heading,
  meta,
  items,
  tone,
}: {
  heading: string;
  meta: string;
  items: MeasureCardItem[];
  tone: "positive" | "amber";
}) {
  const headingId = heading.toLowerCase().replace(/[^a-z]+/g, "-");
  return (
    <section className={styles.cardAccent} aria-labelledby={headingId}>
      <CardAccent />
      <h2 id={headingId} className={styles.h2}>
        {heading}
      </h2>
      <p className={styles.cardMeta}>{meta}</p>
      <ul style={{ listStyle: "none", padding: 0, margin: "var(--space-3) 0 0" }}>
        {items.map((item) => (
          <li
            key={item.measureId}
            style={{
              padding: "var(--space-3) 0",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <div style={{ fontWeight: 600 }}>{item.description}</div>
            <div
              style={{
                fontSize: "13px",
                color:
                  tone === "amber"
                    ? "var(--aims-warning)"
                    : "var(--text-muted)",
              }}
            >
              {item.functionTitle} · {item.storyLine}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
