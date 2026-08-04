import styles from "../marketing.module.css";

// Visual metaphor: a transcript file flows into three extracted
// commitment rows. No animation on load (page is server-rendered
// with zero JS on this component). The arrow is a static SVG.

export function TranscriptFlowMock() {
  const extracted = [
    { owner: "Shawn Warman", text: "Send updated Q4 forecast by Friday." },
    { owner: "Jen Kim", text: "Schedule follow-up with the ops team next Tuesday." },
    { owner: "Marcus Delaney", text: "Publish the safety incident recap to the crew." },
  ];
  return (
    <div className={styles.transcriptMock} aria-hidden="true">
      <div className={styles.transcriptFileCard}>
        <div className={styles.transcriptFileIcon}>
          <svg viewBox="0 0 20 24" width={22} height={26}>
            <path
              d="M2 2 h11 l5 5 v15 a1 1 0 0 1 -1 1 H2 a0 0 0 0 1 0 0 z"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.4}
              strokeLinejoin="round"
            />
            <path
              d="M13 2 v5 h5"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.4}
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div className={styles.transcriptFileMeta}>
          <div className={styles.transcriptFileName}>weekly-leadership.vtt</div>
          <div className={styles.transcriptFileHint}>Analyzed 2 min ago</div>
        </div>
      </div>

      <div className={styles.transcriptArrow} aria-hidden="true">
        <svg viewBox="0 0 60 20" width={60} height={20}>
          <path
            d="M2 10 H50 M42 4 L50 10 L42 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      <ul className={styles.transcriptExtracted}>
        {extracted.map((e, i) => (
          <li key={i} className={styles.transcriptRow}>
            <span className={styles.mockCircleOpen} />
            <div className={styles.transcriptRowText}>
              <div className={styles.transcriptRowDesc}>{e.text}</div>
              <div className={styles.transcriptRowOwner}>
                {e.owner} · From meeting
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
