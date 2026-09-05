import styles from "../marketing.module.css";

// Mini plan cascade: SFA → Goal → Priority → Commitment. Each level
// carries a status chip and a progress bar so the roll-up story is
// legible at a glance.

export function CascadeMock() {
  return (
    <div className={styles.cascadeMock} aria-hidden="true">
      <div className={styles.cascadeLevel} data-level="sfa">
        <div className={styles.cascadeLabel}>Strategic Focus Area</div>
        <div className={styles.cascadeTitle}>Grow the Northwest region</div>
        <div className={styles.cascadeStateRow}>
          <span className={styles.mockChipOnTrack}>On track</span>
          <div className={styles.cascadeBar}>
            <div className={styles.cascadeBarFill} style={{ width: "72%" }} />
          </div>
        </div>
      </div>

      <div className={styles.cascadeConnector} aria-hidden="true" />

      <div className={styles.cascadeLevel} data-level="goal">
        <div className={styles.cascadeLabel}>Annual Goal</div>
        <div className={styles.cascadeTitle}>
          Open two branches in Idaho and Oregon
        </div>
        <div className={styles.cascadeStateRow}>
          <span className={styles.mockChipOnTrack}>On track</span>
          <div className={styles.cascadeBar}>
            <div className={styles.cascadeBarFill} style={{ width: "60%" }} />
          </div>
        </div>
      </div>

      <div className={styles.cascadeConnector} aria-hidden="true" />

      <div className={styles.cascadeLevel} data-level="priority">
        <div className={styles.cascadeLabel}>90-Day Priority</div>
        <div className={styles.cascadeTitle}>
          Sign the Boise location lease
        </div>
        <div className={styles.cascadeStateRow}>
          <span className={styles.mockChipBehind}>Behind</span>
          <div className={styles.cascadeBar}>
            <div className={styles.cascadeBarFill} style={{ width: "35%" }} />
          </div>
        </div>
      </div>

      <div className={styles.cascadeConnector} aria-hidden="true" />

      <div className={styles.cascadeLevel} data-level="commitment">
        <div className={styles.cascadeLabel}>This week&apos;s commitment</div>
        <div className={styles.cascadeTitle}>
          Get final lease terms from broker by Thursday
        </div>
      </div>
    </div>
  );
}
