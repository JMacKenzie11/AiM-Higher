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
        <MeasureCard
          heading="Gaining ground this quarter"
          meta="Measures moving in the right direction across the last 6 weeks."
          items={insights.gainingGround}
          tone="positive"
        />
      ) : null}
      {insights.streaks.length > 0 ? (
        <MeasureCard
          heading="Streaks in flight"
          meta="At or above target for 3+ consecutive weeks."
          items={insights.streaks}
          tone="positive"
        />
      ) : null}
      {insights.winsThisWeek.length > 0 ? (
        <MeasureCard
          heading="Wins this week"
          meta="Measures that hit target for the week just ended."
          items={insights.winsThisWeek}
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
  return (
    <section
      className={styles.cardAccent}
      aria-labelledby={heading.toLowerCase().replace(/[^a-z]+/g, "-")}
    >
      <CardAccent />
      <h2
        id={heading.toLowerCase().replace(/[^a-z]+/g, "-")}
        className={styles.h2}
      >
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
                    ? "var(--aims-warning, #b78103)"
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
