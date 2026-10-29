import Link from "next/link";
import type { ReactNode } from "react";
import { SectionTabs } from "@/components/sidebar/NavInfo";
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
  // Content starts below the hero instead of overlapping its last
  // 32px, as on Company settings: nothing sits in the hero but its
  // own title and text (Jason, 2026-10-29, the diagnostic pages).
  flush?: boolean;
  children: ReactNode;
};

// The card for a page that is only a short message and one way
// forward (the error pages). Children are page content and sit below
// the hero, but the content band overlaps the hero's last 32px, so
// bare text there lands on the navy. Every other page opens with a
// card of its own; this is that card for pages with nothing else.
export function PageShellNotice({ children }: { children: ReactNode }) {
  return <section className={styles.notice}>{children}</section>;
}

export function PageShell({
  title,
  subtitle,
  eyebrow,
  heroExtras,
  backHref,
  backLabel,
  ariaLabel,
  flush,
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
          {/* The section's pages, under the "nav-sections" switch. */}
          <SectionTabs />
        </div>
      </section>
      <div className={flush ? `${styles.content} ${styles.contentFlush}` : styles.content}>{children}</div>
    </div>
  );
}
