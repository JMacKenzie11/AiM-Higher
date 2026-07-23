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

// Module-tagged nav items. Each item's `feature` determines whether
// it renders for a given company — hidden if the company hasn't
// subscribed. `null` means always-visible.
//
// Items can be flat links or grouped dropdowns. Grouping keeps the
// top row uncluttered (Section 7): daily-use items stay top-level;
// set-once surfaces like Foundation live under Company; multi-page
// modules like Strengths collapse to one dropdown.
type Feature = "execution" | "strengths";
type NavLink = { kind: "link"; label: string; href: string };
type NavItem =
  | (NavLink & { feature: Feature | null })
  | {
      kind: "group";
      label: string;
      feature: Feature | null;
      items: readonly NavLink[];
    };

// Nav shape:
//   [Companies (sysadmin only)]  Dashboard  Company ▾  Strengths ▾  [user ▾]
// Dashboard stays top-level as the daily entry point; every other
// company-scoped surface (Plan, Commitments, People, Foundation) lives
// under Company ▾ so the mental model matches ownership ("these all
// belong to the same company you're operating on") rather than usage
// frequency. Foundation used to be alone under Company; now the group
// has real weight and the top row fits comfortably on one line.
const APP_ITEMS: readonly NavItem[] = [
  { kind: "link", label: "Dashboard", href: "/dashboard", feature: "execution" },
  {
    kind: "group",
    label: "Company",
    feature: "execution",
    items: [
      { kind: "link", label: "Plan", href: "/plan" },
      { kind: "link", label: "Chart", href: "/chart" },
      { kind: "link", label: "Commitments", href: "/commitments" },
      { kind: "link", label: "People", href: "/people" },
      { kind: "link", label: "Foundation", href: "/foundation" },
    ],
  },
  {
    kind: "group",
    label: "Strengths",
    feature: "strengths",
    items: [
      { kind: "link", label: "Assessment", href: "/strengths/assessment" },
      { kind: "link", label: "Results", href: "/strengths/results" },
      { kind: "link", label: "Teams", href: "/strengths/teams" },
    ],
  },
];

// ASSUMPTION: Scorecard route (/scorecard) still exists but is
// intentionally omitted from the nav while the Functional Scorecard
// design is being rethought. When restored it belongs immediately
// after Commitments with feature: "execution".

const SYSTEM_ADMIN_ITEM: NavItem = {
  kind: "link",
  label: "Companies",
  href: "/admin/companies",
  feature: null,
};

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

  // Filter by module subscription. Feature `null` items always render.
  // The "${company} Dashboard" rebadge is gone — the sub-band already
  // carries the scoped-company signal on execution surfaces, and the
  // long label was wrapping the whole nav to three lines.
  const subscribedApp = APP_ITEMS.filter(
    (item) => item.feature === null || features.includes(item.feature)
  );

  // A system_admin who hasn't scoped into a company can't visit any of
  // the app pages meaningfully — every one redirects to /admin/companies.
  // Also: while on the /admin surface itself, hide app links even if a
  // scope cookie lingers from a prior session — the sysadmin is here to
  // pick or manage companies, not to peek at whichever one they were
  // last inside.
  const onAdminSurface = pathname.startsWith("/admin");

  // The "operating as this company" sub-band only makes sense on
  // execution-module surfaces. Strengths is a personal assessment,
  // coach + profile are user-scoped, and /admin is the company picker
  // itself — none of them are "inside a company" in the way the band
  // suggests. Exit Company still reachable via the user menu.
  const onPersonalSurface =
    pathname.startsWith("/strengths") ||
    pathname.startsWith("/coach") ||
    pathname.startsWith("/profile");
  const showContextBand =
    isSystemAdmin &&
    Boolean(contextLabel) &&
    !onAdminSurface &&
    !onPersonalSurface;

  const items: NavItem[] = isSystemAdmin
    ? showExitScope && !onAdminSurface
      ? [SYSTEM_ADMIN_ITEM, ...subscribedApp]
      : [SYSTEM_ADMIN_ITEM]
    : subscribedApp;

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
            {items.map((item) =>
              item.kind === "link" ? (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={styles.navLink}
                    data-active={isLinkActive(pathname, item.href) ? "true" : undefined}
                    aria-current={
                      isLinkActive(pathname, item.href) ? "page" : undefined
                    }
                  >
                    {item.label}
                  </Link>
                </li>
              ) : (
                <li key={item.label}>
                  <NavDropdown group={item} pathname={pathname} />
                </li>
              )
            )}
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

        <UserMenu
          userName={userName}
          userProfileId={userProfileId}
          showExitScope={isSystemAdmin && showExitScope}
          scopedCompanyName={scopedCompanyName}
        />
      </div>

      {mobileOpen ? (
        <div
          id="mobile-nav-drawer"
          className={styles.mobileDrawer}
          role="navigation"
          aria-label="Primary mobile"
        >
          <ul className={styles.mobileList}>
            {items.flatMap((item) =>
              item.kind === "link"
                ? [
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={styles.mobileLink}
                        data-active={
                          isLinkActive(pathname, item.href) ? "true" : undefined
                        }
                        aria-current={
                          isLinkActive(pathname, item.href) ? "page" : undefined
                        }
                      >
                        {item.label}
                      </Link>
                    </li>,
                  ]
                : [
                    <li key={`${item.label}-header`} className={styles.mobileGroupLabel}>
                      {item.label}
                    </li>,
                    ...item.items.map((child) => (
                      <li key={child.href}>
                        <Link
                          href={child.href}
                          className={`${styles.mobileLink} ${styles.mobileLinkNested}`}
                          data-active={
                            isLinkActive(pathname, child.href) ? "true" : undefined
                          }
                          aria-current={
                            isLinkActive(pathname, child.href) ? "page" : undefined
                          }
                        >
                          {child.label}
                        </Link>
                      </li>
                    )),
                  ]
            )}
          </ul>
        </div>
      ) : null}

      {showContextBand ? (
        <div className={styles.contextBand}>
          <div className={styles.contextInner}>
            <span className={styles.contextText}>{contextLabel}</span>
            {showExitScope ? (
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

function NavDropdown({
  group,
  pathname,
}: {
  group: {
    label: string;
    items: readonly { label: string; href: string }[];
  };
  pathname: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape — same pattern as the user menu.
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

  // Collapse when the route changes so a nav click doesn't leave the
  // menu hanging open over the new page.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const groupActive = group.items.some((child) => isLinkActive(pathname, child.href));

  return (
    <div className={styles.dropdownWrap} ref={ref}>
      <button
        type="button"
        className={styles.navLink}
        data-active={groupActive ? "true" : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        {group.label}
        <span className={styles.navChevron} aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        <div className={styles.dropdownMenu} role="menu">
          {group.items.map((child) => (
            <Link
              key={child.href}
              href={child.href}
              className={styles.menuItem}
              role="menuitem"
              data-active={isLinkActive(pathname, child.href) ? "true" : undefined}
              aria-current={
                isLinkActive(pathname, child.href) ? "page" : undefined
              }
            >
              {child.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function UserMenu({
  userName,
  userProfileId,
  showExitScope,
  scopedCompanyName,
}: {
  userName: string;
  userProfileId: string;
  showExitScope: boolean;
  scopedCompanyName?: string;
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
          {showExitScope ? (
            <form action={exitCompanyScopeAction}>
              <button
                type="submit"
                className={styles.menuItem}
                role="menuitem"
              >
                Exit {scopedCompanyName ?? "company"}
              </button>
            </form>
          ) : null}
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
