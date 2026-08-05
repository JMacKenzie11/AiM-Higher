import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./PageShell.module.css";

// Shared page chrome: gradient hero on top, content band underneath
// that overlaps the hero by 32px. Every app page should render its
// header via this component instead of hand-rolling a header, so the
// whole product has one shape.

export type PageShellProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  heroExtras?: ReactNode;
  // Optional back link rendered above the eyebrow. Used by detail
  // pages that want a "← back to X" affordance without hand-rolling.
  backHref?: string;
  backLabel?: string;
  ariaLabel?: string;
  children: ReactNode;
};

export function PageShell({
  title,
  subtitle,
  eyebrow,
  heroExtras,
  backHref,
  backLabel,
  ariaLabel,
  children,
}: PageShellProps) {
  return (
    <div className={styles.stage}>
      <section
        className={styles.hero}
        aria-label={ariaLabel ?? (typeof title === "string" ? title : undefined)}
      >
        <div className={styles.heroInner}>
          {backHref ? (
            <Link href={backHref} className={styles.backLink}>
              ← {backLabel ?? "Back"}
            </Link>
          ) : null}
          {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
          <h1 className={styles.h1}>{title}</h1>
          <span className={styles.rule} aria-hidden="true" />
          {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
          {heroExtras}
        </div>
      </section>
      <div className={styles.content}>{children}</div>
    </div>
  );
}
