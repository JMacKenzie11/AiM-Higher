import styles from "@/app/(app)/strengths/strengths.module.css";

export default function ProgressBar({
  current,
  total,
}: {
  current: number;
  total: number;
}) {
  const pct = total === 0 ? 0 : Math.min(100, (current / total) * 100);
  return (
    <div className={styles.stack2}>
      <div className={styles.barTrack} aria-label={`Progress: ${current} of ${total}`}>
        <div
          className={`${styles.barFill} ${styles.barCompetence}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className={`${styles.muted} aims-tabular`}>
        {current} of {total}
      </div>
    </div>
  );
}
