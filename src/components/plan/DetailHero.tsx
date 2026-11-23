import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./DetailHero.module.css";

// Detail-page header (Scoreboard design, 2026-11-23): the navy tile
// every page has, holding the back link, eyebrow, title and meta, then
// a white card with the state and actions. It was a gradient band with
// the card overlapping its foot.

export type DetailHeroProps = {
  breadcrumbHref: string;
  breadcrumbLabel: string;
  eyebrow?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
};

export function DetailHero({
  breadcrumbHref,
  breadcrumbLabel,
  eyebrow,
  title,
  meta,
  children,
}: DetailHeroProps) {
  return (
    <div className={styles.wrap}>
      <div className={styles.band}>
        <div className={styles.bandInner}>
          <Link href={breadcrumbHref} className={styles.crumb}>
            ← {breadcrumbLabel}
          </Link>
        </div>
        {eyebrow ? <div className={styles.eyebrow}>{eyebrow}</div> : null}
        <h1 className={styles.title}>{title}</h1>
        <span className="aims-rule" aria-hidden="true" />
        {meta ? <div className={styles.meta}>{meta}</div> : null}
      </div>

      <div className={styles.card}>
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  );
}
