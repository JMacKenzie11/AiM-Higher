import styles from "./plan-visuals.module.css";

// Cobalt progress bar on a navy-tint track. Rounded ends. Percent
// labeled at the right in tabular-nums. Fill animates once on load
// via CSS (--duration-slow, ease-out). No labels when percent is null;
// caller renders the "No commitments yet" muted note instead.

export function ProgressBar({
  percent,
  label,
}: {
  percent: number | null;
  label?: string;
}) {
  if (percent === null) {
    // "No data yet" state: render the empty track + a "—" label so it
    // looks structurally the same as a filled bar and doesn't read as
    // an error. `label` becomes the accessible name via aria-label.
    return (
      <span
        className={styles.progressWrap}
        aria-label={label ?? "No data yet"}
      >
        <span
          className={`${styles.progressTrack} ${styles.progressTrackEmpty}`}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={0}
        />
        <span className={`${styles.progressLabel} ${styles.progressLabelEmpty}`}>
          —
        </span>
      </span>
    );
  }
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <span className={styles.progressWrap}>
      <span
        className={styles.progressTrack}
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span
          className={styles.progressFill}
          style={{ width: `${clamped}%` }}
        />
      </span>
      <span className={styles.progressLabel}>{clamped}%</span>
    </span>
  );
}
