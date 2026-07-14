import Image from "next/image";
import type { ReactNode } from "react";
import styles from "./AuthShell.module.css";

// ASSUMPTION: served from /public/brand (mirror of brand/assets/) to
// avoid the static-import blur pipeline that requires sharp.
const LOGO_WHITE_SRC = "/brand/logo-white.png";

export type AuthShellProps = {
  headline: ReactNode;
  subtitle: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  cardLabel: string;
};

// Shared full-viewport --grad-brand shell for every unauthenticated page.
// Reproduces the Section 8.1 composition exactly and hosts each page's
// specific form inside its glass card.
export function AuthShell({
  headline,
  subtitle,
  children,
  footer,
  cardLabel,
}: AuthShellProps) {
  return (
    <main className={styles.stage}>
      <div className={styles.column}>
        <Image
          src={LOGO_WHITE_SRC}
          alt="AiMS"
          priority
          width={160}
          height={40}
          className={styles.logo}
        />

        <h1 className={styles.headline}>{headline}</h1>
        <span className={styles.rule} aria-hidden="true" />
        <p className={styles.subtitle}>{subtitle}</p>

        <section className={styles.card} aria-label={cardLabel}>
          {children}
        </section>

        {footer ? <div className={styles.footerLink}>{footer}</div> : null}
      </div>
    </main>
  );
}
