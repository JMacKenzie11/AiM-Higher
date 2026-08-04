"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MobileNavToggle, type NavLink } from "./MobileNavToggle";
import { demoUrl } from "./demo-url";
import styles from "./marketing.module.css";

// Sticky slim marketing nav. Links flip based on route: on / the
// anchor links jump to sections and "For coaches" links to /coaches;
// on /coaches the nav collapses to a single "For owners" link back
// to /. Client component so it can read pathname without doing a
// session fetch from the server layout.

const OWNER_LINKS: NavLink[] = [
  { label: "Platform", href: "#platform" },
  { label: "How it works", href: "#how-it-works" },
  { label: "For coaches", href: "/coaches" },
];

const COACH_LINKS: NavLink[] = [
  { label: "For owners", href: "/" },
];

export function MarketingHeader() {
  const pathname = usePathname() ?? "/";
  const links = pathname.startsWith("/coaches") ? COACH_LINKS : OWNER_LINKS;

  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <Link href="/" className={styles.headerLogoLink} aria-label="AiMS Higher home">
          <Image
            src="/brand/aimshigher-logo-color.svg"
            alt="AiMS Higher"
            width={620}
            height={142}
            className={styles.headerLogo}
            priority
          />
        </Link>

        <nav className={styles.headerNav} aria-label="Primary">
          <ul className={styles.headerNavList}>
            {links.map((l) => (
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

        <MobileNavToggle links={links} />
      </div>
    </header>
  );
}
