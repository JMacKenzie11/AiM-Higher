import Image from "next/image";
import styles from "./marketing.module.css";

export function MarketingFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <div className={styles.footerBrand}>
          <Image
            src="/brand/aimshigher-logo-white.svg"
            alt="AiMS Higher"
            width={620}
            height={142}
            className={styles.footerLogo}
          />
          <p className={styles.footerTagline}>
            AiMS Higher&trade; is built by the AiMS Institute.
          </p>
        </div>
      </div>
    </footer>
  );
}
