import styles from "../marketing.module.css";

// Mini dashboard visual for the hero card. Non-interactive, populated
// with realistic static sample data. Built with the same tokens as
// the real dashboard so the resemblance is unmistakable.

export function HeroDashboardMock() {
  const stats = [
    { label: "Strategic Progress", value: "72%", caption: "Focus areas this quarter" },
    { label: "Follow-Through Rate", value: "84%", caption: "Resolved on time" },
    { label: "On Track", value: "9/12", caption: "Priorities pacing" },
    { label: "Open This Week", value: "23", caption: "Due by Friday" },
  ];
  return (
    <div className={styles.heroMock} aria-hidden="true">
      <div className={styles.heroMockBar}>
        <span className={styles.heroMockEyebrow}>Q4 · Meridian Construction</span>
      </div>
      <div className={styles.heroMockStats}>
        {stats.map((s) => (
          <div key={s.label} className={styles.heroMockStat}>
            <span className={styles.heroMockValue}>{s.value}</span>
            <span className={styles.heroMockLabel}>{s.label}</span>
            <span className={styles.heroMockCaption}>{s.caption}</span>
          </div>
        ))}
      </div>
      <div className={styles.heroMockTrend}>
        <div className={styles.heroMockTrendLabel}>Follow-Through Rate · last 12 weeks</div>
        <div className={styles.heroMockBars}>
          {[52, 60, 58, 66, 71, 68, 74, 78, 80, 82, 80, 84].map((h, i) => (
            <div
              key={i}
              className={styles.heroMockBarCol}
              style={{ ["--h" as string]: `${h}%` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
