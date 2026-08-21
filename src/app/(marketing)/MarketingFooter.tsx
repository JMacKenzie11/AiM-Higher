import Image from "next/image";
import styles from "./marketing.module.css";

export function MarketingFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <div className={styles.footerBrand}>
          <Image
            src="/brand/aims-hq-logo-white.png"
            alt="AiMS HQ"
            width={140}
            height={32}
            className={styles.footerLogo}
          />
          <p className={styles.footerTagline}>
            AiMS HQ&trade; is built by the AiMS Institute.
          </p>
        </div>
      </div>
    </footer>
  );
}
