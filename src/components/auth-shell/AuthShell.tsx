import Image from "next/image";
import type { ReactNode } from "react";
import styles from "./AuthShell.module.css";

// AiMS Higher wordmark, white on the --grad-brand auth stage.
// ASSUMPTION: served from /public/brand (mirror of brand/assets/) to
// avoid the static-import blur pipeline that requires sharp.
const LOGO_WHITE_SRC = "/brand/aimshigher-logo-white.png";
// Source PNG is 620×142; container height set in CSS.
const LOGO_INTRINSIC_WIDTH = 620;
const LOGO_INTRINSIC_HEIGHT = 142;

export type AuthShellProps = {
  headline: ReactNode;
  subtitle?: ReactNode;
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
          alt="AiMSHigher"
          priority
          width={LOGO_INTRINSIC_WIDTH}
          height={LOGO_INTRINSIC_HEIGHT}
          className={styles.logo}
        />

        <h1 className={styles.headline}>{headline}</h1>
        {subtitle ? (
          <>
            <span className={styles.rule} aria-hidden="true" />
            <p className={styles.subtitle}>{subtitle}</p>
          </>
        ) : null}

        <section className={styles.card} aria-label={cardLabel}>
          {children}
        </section>

        {footer ? <div className={styles.footerLink}>{footer}</div> : null}
      </div>
    </main>
  );
}
