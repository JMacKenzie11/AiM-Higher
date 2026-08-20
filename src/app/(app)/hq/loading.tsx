import styles from "./hq.module.css";

// Loading skeleton for /hq. Renders instantly on navigation so the
// user sees the page shell + shimmering placeholders while the
// server component finishes its data fetch. Without this, clicking
// Guide HQ produces no visible feedback for 8-10s and reads as a
// broken link.
//
// The shimmer animation lives in hq.module.css so it can be shared
// with any other section that wants the same skeleton treatment.

export default function Loading() {
  return (
    <div className={styles.stage}>
      <section className={styles.hero} aria-label="Guide HQ header">
        <div className={styles.heroInner}>
          <p className={styles.eyebrow}>Loading your caseload…</p>
          <h1 className={styles.h1}>Guide HQ</h1>
          <span className={styles.rule} aria-hidden="true" />
          <p className={styles.subtitle}>
            Assembling your commitments, the attention queue for this
            week, and a read on the shape of your caseload.
          </p>
        </div>
      </section>
      <div className={styles.content}>
        <SkeletonSection title="My commitments" rowCount={3} />
        <SkeletonSection title="Needs your attention" rowCount={2} />
        <SkeletonSection title="Your companies" rowCount={4} />
        <SkeletonSection title="Recent activity" rowCount={3} />
      </div>
    </div>
  );
}

function SkeletonSection({
  title,
  rowCount,
}: {
  title: string;
  rowCount: number;
}) {
  return (
    <section className={styles.card} aria-busy="true" aria-label={`${title} loading`}>
      <div className={styles.skeletonHeading}>
        <span className={styles.skeletonTitleText}>{title}</span>
        <span className={styles.skeletonDot} aria-hidden="true" />
      </div>
      <div className={styles.skeletonRows}>
        {Array.from({ length: rowCount }).map((_, i) => (
          <div key={i} className={styles.skeletonRow}>
            <span className={`${styles.skeletonBar} ${styles.skeletonBarWide}`} />
            <span className={`${styles.skeletonBar} ${styles.skeletonBarNarrow}`} />
          </div>
        ))}
      </div>
    </section>
  );
}
