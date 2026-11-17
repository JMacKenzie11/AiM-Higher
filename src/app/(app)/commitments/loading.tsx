import styles from "./commitments.module.css";

export default function Loading() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.h1}>Commitments</h1>
        <span className="aims-rule" aria-hidden="true" />
        <p className={styles.subtitle}>Loading this week…</p>
      </header>
    </div>
  );
}
