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
type Feature =
  | "execution"
  | "strengths"
  | "performance_tracking"
  | "classroom";
type NavRole = "system_admin" | "company_admin" | "team_member" | "aims_guide";
// Items may declare `roles` — a caller with a role NOT in the list
// won't see the item. Missing/null means "everyone". Applied to both
// top-level links and to individual items within a dropdown group.
// NavLink is the shape for a group's child items — feature is an
// optional additional gate on top of the group's feature (child
// hidden if either is off).
type NavLink = {
  kind: "link";
  label: string;
  href: string;
  roles?: readonly NavRole[];
  feature?: Feature;
};
// Top-level NavItems require a feature (or explicit null for
// always-visible). Groups have children that carry their own optional
// feature overrides.
type NavItem =
  | {
      kind: "link";
      label: string;
      href: string;
      roles?: readonly NavRole[];
      feature: Feature | null;
    }
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
const ADMIN_ROLES: readonly NavRole[] = [
  "system_admin",
  "company_admin",
  "aims_guide",
];

const APP_ITEMS: readonly NavItem[] = [
  {
    kind: "group",
    label: "Disciplines",
    feature: "execution",
    items: [
      { kind: "link", label: "One-Page Plan", href: "/foundation" },
      { kind: "link", label: "People", href: "/people" },
      { kind: "link", label: "Chart", href: "/chart" },
      // Success Measures sits directly under Chart so the metric
      // definition (on the chart) and the weekly logging surface
      // read as adjacent. Entitlement-gated at the item level:
      // hidden for companies without Success Tracking unless there's
      // already at least one metric on file (the outer layout
      // toggles hasChartMeasures to admit this link in that case).
      {
        kind: "link",
        label: "Success Measures",
        href: "/measures",
        feature: "performance_tracking",
      },
      { kind: "link", label: "Plan", href: "/plan" },
      { kind: "link", label: "Commitments", href: "/commitments" },
      // Meetings (route stays /leadership) hosts meeting-transcript
      // analyses; only admins / coaches see it. Team members get the
      // resulting commitments and email, not the full write-up.
      { kind: "link", label: "Meetings", href: "/leadership", roles: ADMIN_ROLES },
    ],
  },
  // Resources — personal-use surfaces (Ask Aimee, Classroom). Group
  // feature is null so it always renders; Ask Aimee has no gate so
  // the group never fully collapses. Classroom's per-child feature
  // gate hides it for tenants without the entitlement. The authoring
  // surface sits next to the consumer view for sysadmins only — they
  // were the ones who found the previous top-level duplicate confusing.
  {
    kind: "group",
    label: "Resources",
    feature: null,
    items: [
      { kind: "link", label: "Ask Aimee", href: "/ask-aimee" },
      {
        kind: "link",
        label: "Classroom",
        href: "/classroom",
        feature: "classroom",
      },
      {
        kind: "link",
        label: "Classroom admin",
        href: "/admin/classroom",
        roles: ["system_admin"],
      },
    ],
  },
  // Strengths — personal assessment + admin team-recommendation
  // surface. Whole group hides when the tenant doesn't have the
  // feature. Teams is gated to admins because the page redirects
  // team members away.
  {
    kind: "group",
    label: "Strengths",
    feature: "strengths",
    items: [
      { kind: "link", label: "My assessment", href: "/strengths/welcome" },
      {
        kind: "link",
        label: "Teams",
        href: "/strengths/teams",
        roles: ["system_admin", "company_admin"],
      },
    ],
  },
  { kind: "link", label: "Dashboard", href: "/dashboard", feature: "execution" },
];

// ASSUMPTION: Scorecard route (/scorecard) still exists but is
// intentionally omitted from the nav while the Functional Scorecard
// design is being rethought. When restored it belongs immediately
// after Commitments with feature: "execution".

const SYSTEM_ADMIN_ITEMS: readonly NavItem[] = [
  { kind: "link", label: "Companies", href: "/admin/companies", feature: null },
];

export type NavBandProps = {
  userName: string;
  userRole: NavRole;
  isSystemAdmin: boolean;
  contextLabel?: string;
  showExitScope?: boolean;
  scopedCompanyName?: string;
  features?: readonly string[];
  // True when the company has at least one non-archived success
  // measure. Lets the /measures nav link surface for companies that
  // haven't turned on the paid Success Tracking entitlement yet but
  // are already using the module — so admins scoped in never wonder
  // where the menu went.
  hasChartMeasures?: boolean;
};

export function NavBand({
  userName,
  userRole,
  isSystemAdmin,
  contextLabel,
  showExitScope = false,
  scopedCompanyName,
  features = [],
  hasChartMeasures = false,
}: NavBandProps) {
  const pathname = usePathname() ?? "";
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Fade a soft shadow in only once the sticky band has detached from
  // the top edge — cheap IntersectionObserver on a zero-height sentinel
  // placed just above the band. Beats scroll listeners on cost and
  // avoids layout thrashing.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setScrolled(!entry.isIntersecting),
      { threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  // Accepts both group children (feature?: Feature) and top-level
  // items (feature: Feature | null). Top-level items with feature=null
  // have already been admitted by the outer filter; linkVisible only
  // uses feature to reject when it's set to a specific value the
  // company doesn't have.
  function linkVisible(link: {
    roles?: readonly NavRole[];
    feature?: Feature | null;
  }): boolean {
    if (link.roles && !link.roles.includes(userRole)) return false;
    if (link.feature && !features.includes(link.feature)) {
      // performance_tracking is entitlement-gated, but any company
      // that has already added at least one metric on the chart gets
      // to see the /measures nav link — the paid side-effects stay
      // off, this is just discoverability.
      if (link.feature === "performance_tracking" && hasChartMeasures) {
        return true;
      }
      return false;
    }
    return true;
  }

  // Filter by module subscription + per-item role, then trim dropdown
  // children by role and per-child feature too. Groups with zero
  // visible children collapse away entirely.
  const subscribedApp = APP_ITEMS.flatMap<NavItem>((item) => {
    if (item.feature !== null && !features.includes(item.feature)) return [];
    if (item.kind === "link") return linkVisible(item) ? [item] : [];
    const filteredChildren = item.items.filter(linkVisible);
    if (filteredChildren.length === 0) return [];
    return [{ ...item, items: filteredChildren }];
  });

  // The /admin/companies picker itself is a "not inside a company yet"
  // surface — hide app links there. A specific company's settings page
  // (/admin/companies/[id]) is the opposite: the sysadmin IS operating
  // on that company (middleware auto-scopes the cookie), so the top
  // nav should behave as it would on any company-scoped page.
  const onAdminPicker =
    pathname === "/admin" ||
    pathname === "/admin/companies" ||
    pathname === "/admin/companies/";

  // The "operating as this company" sub-band only makes sense on
  // execution-module surfaces. Strengths is a personal assessment,
  // coach + profile are user-scoped, and the /admin picker is where you
  // pick a company, not a company you're inside. Exit Company still
  // reachable via the user menu on all those surfaces.
  const onPersonalSurface =
    pathname.startsWith("/strengths") ||
    pathname.startsWith("/coach") ||
    pathname.startsWith("/profile");
  const showContextBand =
    isSystemAdmin &&
    Boolean(contextLabel) &&
    !onAdminPicker &&
    !onPersonalSurface;

  // Filter SYSTEM_ADMIN_ITEMS through linkVisible so per-item `roles`
  // gates (e.g. Classroom = system_admin only) apply even though
  // guides share this nav slot with sysadmins.
  const adminItems = SYSTEM_ADMIN_ITEMS.filter((item) =>
    item.kind === "link" ? linkVisible(item) : true
  );
  const items: NavItem[] = isSystemAdmin
    ? showExitScope && !onAdminPicker
      ? [...adminItems, ...subscribedApp]
      : [...adminItems]
    : subscribedApp;

  return (
    <>
      <div ref={sentinelRef} className={styles.stickySentinel} aria-hidden="true" />
      <header className={styles.band} data-scrolled={scrolled ? "true" : undefined}>
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
    </>
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
  showExitScope,
  scopedCompanyName,
}: {
  userName: string;
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
