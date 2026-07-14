import styles from "./skeleton.module.css";

// Skeleton primitives — Section 9.9. Navy-tint bars used to hint at
// content structure while a server component streams in. Deliberately
// static (no shimmer) so we don't violate the "no continuous animation"
// rule from Section 3. A subtle one-time fade-in is the only motion.

export function SkeletonBar({
  width = "100%",
  height = 12,
  className,
}: {
  width?: string | number;
  height?: string | number;
  className?: string;
}) {
  return (
    <span
      className={`${styles.bar} ${className ?? ""}`}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}

export function SkeletonBlock({
  height = 96,
  className,
}: {
  height?: string | number;
  className?: string;
}) {
  return (
    <div
      className={`${styles.block} ${className ?? ""}`}
      style={{ height }}
      aria-hidden="true"
    />
  );
}

export function SkeletonHeader() {
  return (
    <div className={styles.header} aria-hidden="true">
      <SkeletonBar width={220} height={28} />
      <SkeletonBar width={56} height={3} />
      <SkeletonBar width={320} height={12} />
    </div>
  );
}

export function SkeletonHero({
  showStats = false,
}: {
  showStats?: boolean;
}) {
  return (
    <div className={styles.hero} aria-hidden="true">
      <div className={styles.heroInner}>
        <SkeletonBar width={120} height={11} className={styles.onDark} />
        <SkeletonBar width={320} height={34} className={styles.onDark} />
        <SkeletonBar width={72} height={3} className={styles.onDarkChartreuse} />
        <SkeletonBar width={480} height={14} className={styles.onDark} />
        {showStats ? (
          <div className={styles.statRow}>
            <SkeletonBlock height={92} className={styles.glass} />
            <SkeletonBlock height={92} className={styles.glass} />
            <SkeletonBlock height={92} className={styles.glass} />
            <SkeletonBlock height={92} className={styles.glass} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function SkeletonCard({
  rows = 3,
}: {
  rows?: number;
}) {
  return (
    <div className={styles.card} aria-hidden="true">
      <SkeletonBar width={180} height={20} />
      <div className={styles.stack}>
        {Array.from({ length: rows }).map((_, index) => (
          <SkeletonBar key={index} height={14} />
        ))}
      </div>
    </div>
  );
}

export function SkeletonPage({
  header = true,
  cards = 2,
}: {
  header?: boolean;
  cards?: number;
}) {
  return (
    <div className={styles.page}>
      {header ? <SkeletonHeader /> : null}
      {Array.from({ length: cards }).map((_, index) => (
        <SkeletonCard key={index} rows={4} />
      ))}
    </div>
  );
}

// Layered variant that matches the /dashboard, /people, /admin/companies
// heroes so the load transition doesn't jump.
export function SkeletonLayeredPage({
  cards = 2,
  showStats = true,
}: {
  cards?: number;
  showStats?: boolean;
}) {
  return (
    <div className={styles.stage}>
      <SkeletonHero showStats={showStats} />
      <div className={styles.content}>
        {Array.from({ length: cards }).map((_, index) => (
          <SkeletonCard key={index} rows={4} />
        ))}
      </div>
    </div>
  );
}
