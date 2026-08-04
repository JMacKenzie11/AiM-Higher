import styles from "../marketing.module.css";

// One grounded coaching exchange. Every line references real
// execution signals (last week's kept rate, a specific missed
// commitment, a coaching question). Deliberately concrete so the
// visual doesn't read as generic AI chat.

export function CoachExchangeMock() {
  return (
    <div className={styles.coachMock} aria-hidden="true">
      <div className={styles.coachMockHeader}>
        <span className={styles.coachMockAvatar}>A</span>
        <div>
          <div className={styles.coachMockName}>Aimee</div>
          <div className={styles.coachMockMeta}>Grounded in your data</div>
        </div>
      </div>

      <div className={styles.coachMockThread}>
        <div className={styles.coachMockUserBubble}>
          I want to talk through how Shawn is doing this quarter.
        </div>
        <div className={styles.coachMockAssistantBubble}>
          Shawn kept 8 of 10 commitments this quarter, but two open items
          are past due. The last three missed commitments all name
          scheduling conflicts as the reason. Want to work on the
          scheduling pattern, or is there something bigger under it?
        </div>
      </div>
    </div>
  );
}
