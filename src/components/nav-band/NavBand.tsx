"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { signOutAction } from "@/lib/auth/actions";
import { exitCompanyScopeAction } from "@/lib/admin/scope-actions";
import styles from "./NavBand.module.css";

// Top navigation band used by every authenticated route (Section 7).
// Renders --grad-brand with the white AiMS mark on the left, the fixed
// link set on the right, and a user menu at the far right.
//
// system_admin sees an extra "Companies" link and a persistent
// "SYSTEM ADMIN · <company>" sub-band underneath.
//
// Below 768px, the primary link row collapses into a hamburger toggle
// that opens a drawer beneath the band (Section 9.9 responsive rules).

// The AiMS Higher wordmark. White variant lives here because the nav
// band sits on the --grad-brand surface.
// ASSUMPTION: /public/brand mirrors brand/assets/ so Next.js' static-PNG
// blur pipeline (which requires sharp) isn't invoked at build time.
const LOGO_WHITE_SRC = "/brand/aimshigher-logo-white.png";
// Source PNG is 620×142 (≈4.37:1). Container height is set in CSS.
const LOGO_INTRINSIC_WIDTH = 620;
const LOGO_INTRINSIC_HEIGHT = 142;

// Module-tagged nav links. Each link's `feature` determines whether
// it renders for a given company — hidden if the company hasn't
// subscribed to that module. `null` means always-visible.
type ModuleLink = {
  label: string;
  href: string;
  feature: "execution" | "strengths" | null;
};

const APP_LINKS: readonly ModuleLink[] = [
  { label: "Dashboard", href: "/dashboard", feature: "execution" },
  { label: "Plan", href: "/plan", feature: "execution" },
  { label: "Commitments", href: "/commitments", feature: "execution" },
  { label: "People", href: "/people", feature: "execution" },
  { label: "Foundation", href: "/foundation", feature: "execution" },
  // Strengths Map links — auto-hidden for companies without the
  // 'strengths' feature entitlement. The routes themselves land in
  // sub-phases 5c–5d.
  { label: "Assessment", href: "/strengths/assessment", feature: "strengths" },
  { label: "Results", href: "/strengths/results", feature: "strengths" },
  { label: "Teams", href: "/strengths/teams", feature: "strengths" },
];

// ASSUMPTION: Scorecard route (/scorecard) still exists but is
// intentionally omitted from the nav while the Functional Scorecard
// design is being rethought. When restored it belongs immediately
// after Commitments with feature: "execution".

const SYSTEM_ADMIN_LINK = { label: "Companies", href: "/admin/companies" };

export type NavBandProps = {
  userName: string;
  userProfileId: string;
  isSystemAdmin: boolean;
  contextLabel?: string;
  showExitScope?: boolean;
  scopedCompanyName?: string;
  features?: Array<"execution" | "strengths">;
};

export function NavBand({
  userName,
  userProfileId,
  isSystemAdmin,
  contextLabel,
  showExitScope = false,
  scopedCompanyName,
  features = [],
}: NavBandProps) {
  const pathname = usePathname() ?? "";
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Filter by module subscription first, then rebadge Dashboard for
  // scoped sysadmins. Feature `null` links (if any) always render.
  const subscribedLinks = APP_LINKS.filter(
    (link) => link.feature === null || features.includes(link.feature)
  );
  const appLinks = subscribedLinks.map((link) =>
    isSystemAdmin && showExitScope && scopedCompanyName && link.href === "/dashboard"
      ? { ...link, label: `${scopedCompanyName} Dashboard` }
      : link
  );

  // A system_admin who hasn't scoped into a company can't visit any of
  // the app pages meaningfully — every one redirects to /admin/companies.
  // Also: while on the /admin surface itself, hide app links even if a
  // scope cookie lingers from a prior session — the sysadmin is here to
  // pick or manage companies, not to peek at whichever one they were
  // last inside.
  const onAdminSurface = pathname.startsWith("/admin");
  const links = isSystemAdmin
    ? showExitScope && !onAdminSurface
      ? [SYSTEM_ADMIN_LINK, ...appLinks]
      : [SYSTEM_ADMIN_LINK]
    : appLinks;

  return (
    <header className={styles.band}>
      <div className={styles.inner}>
        <Link href="/" className={styles.logoLink} aria-label="AiMSHigher home">
          <Image
            src={LOGO_WHITE_SRC}
            alt="AiMSHigher"
            priority
            width={LOGO_INTRINSIC_WIDTH}
            height={LOGO_INTRINSIC_HEIGHT}
            className={styles.logo}
          />
        </Link>

        <nav className={styles.nav} aria-label="Primary">
          <ul className={styles.navList}>
            {links.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className={styles.navLink}
                  data-active={isLinkActive(pathname, link.href) ? "true" : undefined}
                  aria-current={
                    isLinkActive(pathname, link.href) ? "page" : undefined
                  }
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <button
          type="button"
          className={styles.mobileToggle}
          aria-controls="mobile-nav-drawer"
          aria-expanded={mobileOpen}
          aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
          onClick={() => setMobileOpen((prev) => !prev)}
        >
          <span className={styles.hamburger} aria-hidden="true">
            {mobileOpen ? "×" : "☰"}
          </span>
        </button>

        <UserMenu userName={userName} userProfileId={userProfileId} />
      </div>

      {mobileOpen ? (
        <div
          id="mobile-nav-drawer"
          className={styles.mobileDrawer}
          role="navigation"
          aria-label="Primary mobile"
        >
          <ul className={styles.mobileList}>
            {links.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className={styles.mobileLink}
                  data-active={
                    isLinkActive(pathname, link.href) ? "true" : undefined
                  }
                  aria-current={
                    isLinkActive(pathname, link.href) ? "page" : undefined
                  }
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {isSystemAdmin && contextLabel ? (
        <div className={styles.contextBand}>
          <div className={styles.contextInner}>
            <span className={styles.contextText}>
              {onAdminSurface ? "System admin" : contextLabel}
            </span>
            {showExitScope && !onAdminSurface ? (
              <form action={exitCompanyScopeAction}>
                <button type="submit" className={styles.contextExit}>
                  Exit company
                </button>
              </form>
            ) : null}
          </div>
        </div>
      ) : null}
    </header>
  );
}

function isLinkActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function UserMenu({
  userName,
  userProfileId,
}: {
  userName: string;
  userProfileId: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(event: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(event.target as Node)) setOpen(false);
    }
    function onEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  return (
    <div className={styles.userSlot} ref={ref}>
      <button
        type="button"
        className={styles.userButton}
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className={styles.userName}>{userName}</span>
        <span className={styles.userChevron} aria-hidden="true">
          ▾
        </span>
      </button>

      {open ? (
        <div className={styles.menu} role="menu">
          <Link
            href={`/coach/${userProfileId}`}
            className={styles.menuItem}
            role="menuitem"
          >
            Get coaching
          </Link>
          <Link href="/profile" className={styles.menuItem} role="menuitem">
            My profile
          </Link>
          <form action={signOutAction}>
            <button
              type="submit"
              className={styles.menuItem}
              role="menuitem"
            >
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
