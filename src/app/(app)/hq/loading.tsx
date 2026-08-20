import styles from "./hq.module.css";

// Loading skeleton for /hq. Renders instantly on navigation so the
// user sees the page shell + a "we're working on it" cue while the
// server component does its (currently expensive) data fetch. Without
// this, clicking Guide HQ produces no visible feedback for 8-10s and
// reads as a broken link.

export default function Loading() {
  return (
    <div className={styles.stage}>
      <section className={styles.hero} aria-label="Guide HQ header">
        <div className={styles.heroInner}>
          <p className={styles.eyebrow}>Loading</p>
          <h1 className={styles.h1}>Guide HQ</h1>
          <span className={styles.rule} aria-hidden="true" />
          <p className={styles.subtitle}>
            Assembling your commitments, the attention queue for this
            week, and a read on the shape of your caseload…
          </p>
        </div>
      </section>
      <div className={styles.content}>
        <section className={styles.card} aria-busy="true">
          <p className={styles.empty}>Loading My commitments…</p>
        </section>
        <section className={styles.card} aria-busy="true">
          <p className={styles.empty}>Loading Needs your attention…</p>
        </section>
        <section className={styles.card} aria-busy="true">
          <p className={styles.empty}>Loading Your companies…</p>
        </section>
        <section className={styles.card} aria-busy="true">
          <p className={styles.empty}>Loading Recent activity…</p>
        </section>
      </div>
    </div>
  );
}
