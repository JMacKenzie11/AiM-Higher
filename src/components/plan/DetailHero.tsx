import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./DetailHero.module.css";

// Layered detail-page hero — Section 8.3.
// Shallow --grad-brand band with a white card overlapping its bottom
// by a small negative margin. Breadcrumb link renders inside the band.

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
      </div>

      <div className={styles.card}>
        {eyebrow ? <div className={styles.eyebrow}>{eyebrow}</div> : null}
        <h1 className={styles.title}>{title}</h1>
        <span className="aims-rule" aria-hidden="true" />
        {meta ? <div className={styles.meta}>{meta}</div> : null}
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  );
}
