import Image from "next/image";
import Link from "next/link";
import styles from "./marketing.module.css";

export function MarketingFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <div className={styles.footerBrand}>
          <Image
            src="/brand/aimshigher-logo-white.svg"
            alt="AiM Higher"
            width={620}
            height={142}
            className={styles.footerLogo}
          />
          <p className={styles.footerTagline}>
            AiM Higher is built by the AiMS Institute.
          </p>
        </div>
        <div className={styles.footerLinks}>
          <Link href="/sign-in" className={styles.footerLink}>
            Sign in
          </Link>
          <a href="mailto:hello@aimshigher.tools" className={styles.footerLink}>
            hello@aimshigher.tools
          </a>
        </div>
      </div>
    </footer>
  );
}
