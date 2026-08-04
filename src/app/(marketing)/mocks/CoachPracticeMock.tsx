import styles from "../marketing.module.css";

// Mini "coach practice at a glance" visual for the /coaches hero.
// Reinforces the "run every client from one login" promise: three
// engagements at different follow-through rates, an always-on
// Aimee chip to signal the methodology working between sessions.

const CLIENTS: Array<{ name: string; rate: number; status: string }> = [
  { name: "Meridian Construction", rate: 84, status: "On rhythm" },
  { name: "Northwest Freight Co.", rate: 71, status: "Meeting this Friday" },
  { name: "Cascade Timber Group", rate: 62, status: "Aimee mid-session" },
];

export function CoachPracticeMock() {
  return (
    <div className={styles.practiceMock} aria-hidden="true">
      <div className={styles.practiceMockHead}>
        <div>
          <div className={styles.practiceMockTitle}>Your practice</div>
          <div className={styles.practiceMockMeta}>
            3 active engagements · Aimee always on
          </div>
        </div>
        <span className={styles.practiceMockChip}>Q4</span>
      </div>

      <ul className={styles.practiceMockList}>
        {CLIENTS.map((c) => (
          <li key={c.name} className={styles.practiceMockRow}>
            <div className={styles.practiceMockAvatar} aria-hidden="true">
              {c.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
            </div>
            <div className={styles.practiceMockRowText}>
              <div className={styles.practiceMockRowName}>{c.name}</div>
              <div className={styles.practiceMockRowStatus}>{c.status}</div>
            </div>
            <div className={styles.practiceMockRateBlock}>
              <div className={styles.practiceMockRateBar}>
                <div
                  className={styles.practiceMockRateFill}
                  style={{ width: `${c.rate}%` }}
                />
              </div>
              <div className={styles.practiceMockRateValue}>{c.rate}%</div>
            </div>
          </li>
        ))}
      </ul>

      <div className={styles.practiceMockFooter}>
        <span className={styles.practiceMockAimeeAvatar}>A</span>
        <span className={styles.practiceMockAimeeCopy}>
          Aimee summarised 4 leadership meetings and drafted 27 commitments
          this week.
        </span>
      </div>
    </div>
  );
}
