import Image from "next/image";
import Link from "next/link";
import { MobileNavToggle } from "./MobileNavToggle";
import { demoUrl } from "./demo-url";
import styles from "./marketing.module.css";

// Sticky slim marketing nav. White bar with a subtle border. Anchor
// links jump to page sections; primary CTA is the demo booking link.
// Sign-in stays quiet — it's for returning users, not the visitor
// this page is written for.

const NAV_LINKS: Array<{ label: string; href: string }> = [
  { label: "Platform", href: "#platform" },
  { label: "How it works", href: "#how-it-works" },
  { label: "For coaches", href: "#for-coaches" },
];

export function MarketingHeader() {
  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <Link href="/" className={styles.headerLogoLink} aria-label="AiM Higher home">
          <Image
            src="/brand/aimshigher-logo-color.svg"
            alt="AiM Higher"
            width={620}
            height={142}
            className={styles.headerLogo}
            priority
          />
        </Link>

        <nav className={styles.headerNav} aria-label="Primary">
          <ul className={styles.headerNavList}>
            {NAV_LINKS.map((l) => (
              <li key={l.href}>
                <a href={l.href} className={styles.headerNavLink}>
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className={styles.headerCtas}>
          <Link href="/sign-in" className={styles.headerSignIn}>
            Sign in
          </Link>
          <a href={demoUrl()} className={styles.headerDemoCta}>
            Book a demo
          </a>
        </div>

        <MobileNavToggle links={NAV_LINKS} />
      </div>
    </header>
  );
}
