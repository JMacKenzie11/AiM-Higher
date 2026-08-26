"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import posthog from "posthog-js";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { signOutAction } from "@/lib/auth/actions";
import { exitCompanyScopeAction } from "@/lib/admin/scope-actions";
import { NotificationBell } from "@/components/nav-band/NotificationBell";
import type { NotificationItem } from "@/lib/notifications/service";
import styles from "./Sidebar.module.css";

// Left-rail primary navigation. Replaces the top NavBand: one click
// to any surface, groups become section headers instead of dropdowns
// (matches the reference design the user shared), and the collapsed
// state is remembered in a cookie so it survives navigation and full
// page loads without flicker (initial render reads from the layout).
//
// Below 768px the rail hides and a hamburger button in a slim top
// strip opens the same rail as a slide-over drawer.

const LOGO_WHITE_SRC = "/brand/aims-hq-logo-white.png";
const LOGO_INTRINSIC_WIDTH = 620;
const LOGO_INTRINSIC_HEIGHT = 142;
const LOGO_MARK_SRC = "/brand/aims-hq-logo-white.png"; // reused; collapsed rail crops via object-fit

type Feature =
  | "execution"
  | "strengths"
  | "performance_tracking"
  | "classroom";
type NavRole = "system_admin" | "company_admin" | "team_member" | "aims_guide";

type NavLink = {
  kind: "link";
  label: string;
  href: string;
  icon: IconName;
  roles?: readonly NavRole[];
  feature?: Feature;
};

type NavItem =
  | {
      kind: "link";
      label: string;
      href: string;
      icon: IconName;
      roles?: readonly NavRole[];
      feature: Feature | null;
    }
  | {
      kind: "group";
      label: string;
      feature: Feature | null;
      items: readonly NavLink[];
    };

const ADMIN_ROLES: readonly NavRole[] = [
  "system_admin",
  "company_admin",
  "aims_guide",
];

// Company-scoped items. Week in Review lives INSIDE the Guide HQ
// group for guides/sysadmins (see GUIDE_HQ_ITEMS below); for regular
// company users it's prepended at composition time so their daily
// entry point stays a single top-level click.
const APP_ITEMS: readonly NavItem[] = [
  {
    kind: "group",
    label: "Workspace",
    feature: "execution",
    items: [
      {
        kind: "link",
        label: "AiMS Implementation",
        href: "/scorecard",
        icon: "gauge",
      },
      { kind: "link", label: "One-Page Plan", href: "/foundation", icon: "doc" },
      { kind: "link", label: "Team", href: "/people", icon: "people" },
      { kind: "link", label: "Functional Org Chart", href: "/chart", icon: "chart" },
      // Key Success Measures nav item pulled 2026-08-27 pending a
      // rethink of the surface. The /measures route + component tree
      // stay in place (chart function page still summary-links into
      // it) but it's off the primary rail.
      { kind: "link", label: "Goals & Priorities", href: "/plan", icon: "calendar" },
      { kind: "link", label: "Issues/Solutions", href: "/issues", icon: "sparkle" },
      { kind: "link", label: "Functional Commitments", href: "/commitments", icon: "check" },
      {
        kind: "link",
        label: "Meeting Summaries",
        href: "/leadership",
        icon: "meeting",
      },
    ],
  },
  {
    kind: "group",
    label: "Resources",
    feature: null,
    items: [
      { kind: "link", label: "Ask Aimee", href: "/ask-aimee", icon: "sparkle" },
      {
        kind: "link",
        label: "Classroom",
        href: "/classroom",
        icon: "book",
        feature: "classroom",
      },
      {
        kind: "link",
        label: "Classroom admin",
        href: "/admin/classroom",
        icon: "book",
        roles: ["system_admin"],
      },
    ],
  },
  {
    kind: "group",
    label: "Strengths",
    feature: "strengths",
    items: [
      {
        kind: "link",
        label: "My assessment",
        href: "/strengths/welcome",
        icon: "spark",
      },
      {
        kind: "link",
        label: "Teams",
        href: "/strengths/teams",
        icon: "people",
        // aims_guide behaves like company_admin on assigned
        // companies — same treatment for the Teams builder.
        roles: ADMIN_ROLES,
      },
    ],
  },
];

// Cross-tenant top items shown for aims_guide + system_admin. Guide
// HQ is the guide's home base; Companies is the fleet list; Week in
// Review is the currently-scoped company's dashboard. Grouping the
// three under a single "Guide HQ" section header keeps the guide's
// daily rhythm — pick a company, glance at the week, dig into the
// caseload — visually together at the top of the rail.
const GUIDE_HQ_ITEMS: readonly NavItem[] = [
  {
    kind: "group",
    label: "Guide HQ",
    feature: null,
    items: [
      {
        kind: "link",
        label: "Overview",
        href: "/hq",
        icon: "dashboard",
        roles: ["system_admin", "aims_guide"],
      },
      {
        kind: "link",
        label: "Companies",
        href: "/admin/companies",
        icon: "building",
        roles: ["system_admin", "aims_guide"],
      },
      {
        kind: "link",
        label: "Week in Review",
        href: "/dashboard",
        icon: "dashboard",
        roles: ["system_admin", "aims_guide"],
      },
    ],
  },
];

// Top-level Week in Review link for non-guide company users
// (company_admin, team_member). Prepended at composition time so
// their daily entry point stays a single click rather than being
// buried inside Workspace.
const WEEK_IN_REVIEW_TOP_LEVEL: NavItem = {
  kind: "link",
  label: "Week in Review",
  href: "/dashboard",
  icon: "dashboard",
  feature: "execution",
};

// Rendered at the very bottom of the nav for system admins only,
// regardless of which company they are currently scoped into.
// Kept in its own group so it reads as a distinct "platform tools"
// band rather than mixing with the current company's rail.
const SYSTEM_ADMIN_BOTTOM_ITEMS: readonly NavItem[] = [
  {
    kind: "group",
    label: "System admin",
    feature: null,
    items: [
      {
        kind: "link",
        label: "Platform",
        href: "/admin/dashboard",
        icon: "measure",
      },
    ],
  },
];

// Bottom band for company admins. Sends them to the /admin/companies
// entry which redirects straight to their own company's settings
// page (see src/app/(app)/admin/companies/page.tsx). Symmetric with
// the system-admin bottom group so both admin roles have a distinct
// "platform tools" band at the bottom.
const COMPANY_ADMIN_BOTTOM_ITEMS: readonly NavItem[] = [
  {
    kind: "group",
    label: "Admin",
    feature: null,
    items: [
      {
        kind: "link",
        label: "Company settings",
        href: "/admin/companies",
        icon: "building",
        roles: ["company_admin"],
      },
    ],
  },
];

export type SidebarProps = {
  userName: string;
  userRole: NavRole;
  isSystemAdmin: boolean;
  contextLabel?: string;
  showExitScope?: boolean;
  scopedCompanyName?: string;
  features?: readonly string[];
  hasChartMeasures?: boolean;
  notifications?: readonly NotificationItem[];
  // Initial collapsed state read from cookie server-side so first
  // paint matches the persisted preference — no post-hydration flicker.
  initialCollapsed?: boolean;
  // Section-group labels the user has collapsed. Same cookie-driven
  // pattern as `initialCollapsed` — layout reads the cookie, hands
  // the parsed list in, so the first paint matches the persisted
  // state instead of flashing all-expanded and snapping shut.
  initialCollapsedGroups?: readonly string[];
};

export function Sidebar({
  userName,
  userRole,
  isSystemAdmin,
  contextLabel,
  showExitScope = false,
  scopedCompanyName,
  features = [],
  hasChartMeasures = false,
  notifications = [],
  initialCollapsed = false,
  initialCollapsedGroups = [],
}: SidebarProps) {
  const pathname = usePathname() ?? "";
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(
    () => new Set(initialCollapsedGroups)
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  // Ref to the inner scrollable nav so we can position the current
  // page's link into view when the mobile drawer opens. Without this,
  // the nav's scrollTop persists between opens (or ends up scrolled
  // into the middle when the content is longer than the drawer),
  // making it look like top items — Dashboard, Companies — have
  // vanished when in fact they're just above the scroll fold.
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    // Wait for the transform-based slide-in to start (rAF is enough)
    // before measuring positions, then bring the active link (or the
    // scroll top if no active link) into view. Prefer nearest so a
    // small scroll adjustment doesn't blow past the top when the
    // active item is already visible.
    const raf = requestAnimationFrame(() => {
      const nav = navRef.current;
      if (!nav) return;
      const active = nav.querySelector<HTMLElement>('[data-active="true"]');
      if (active) {
        active.scrollIntoView({ block: "nearest" });
      } else {
        nav.scrollTop = 0;
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [mobileOpen]);

  const MAX_AGE = 60 * 60 * 24 * 365; // one year

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      // Persist for one year. Cookie (not localStorage) so the server
      // layout can read it on the next request and hand the correct
      // initial state to Sidebar — avoids a hydration jump.
      document.cookie = next
        ? `nav-collapsed=1; path=/; max-age=${MAX_AGE}; samesite=lax`
        : `nav-collapsed=; path=/; max-age=0; samesite=lax`;
      return next;
    });
  }

  function toggleGroup(label: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      // Same cookie-persistence rationale as `nav-collapsed`. Comma-
      // separated list of collapsed group labels; empty string clears
      // the cookie so future sessions start from the "all expanded"
      // default without a stale header hanging around.
      const value = Array.from(next).join(",");
      if (value.length === 0) {
        document.cookie = `nav-groups-collapsed=; path=/; max-age=0; samesite=lax`;
      } else {
        document.cookie = `nav-groups-collapsed=${encodeURIComponent(value)}; path=/; max-age=${MAX_AGE}; samesite=lax`;
      }
      return next;
    });
  }

  function linkVisible(link: {
    roles?: readonly NavRole[];
    feature?: Feature | null;
  }): boolean {
    if (link.roles && !link.roles.includes(userRole)) return false;
    if (link.feature && !features.includes(link.feature)) {
      if (link.feature === "performance_tracking" && hasChartMeasures) {
        return true;
      }
      return false;
    }
    return true;
  }

  const subscribedApp = APP_ITEMS.flatMap<NavItem>((item) => {
    if (item.feature !== null && !features.includes(item.feature)) return [];
    if (item.kind === "link") return linkVisible(item) ? [item] : [];
    const filteredChildren = item.items.filter(linkVisible);
    if (filteredChildren.length === 0) return [];
    return [{ ...item, items: filteredChildren }];
  });

  const onAdminPicker =
    pathname === "/admin" ||
    pathname === "/admin/companies" ||
    pathname === "/admin/companies/";
  // While the caller is at Guide HQ, hide company-scoped nav items
  // (Dashboard, Chart, Plan, …) even if a scope cookie is set. The
  // cookie stays put so clicking Dashboard from anywhere else still
  // returns to the last-scoped company; /hq itself just doesn't show
  // those links because HQ is the unscoped home base.
  const onHqSurface = pathname === "/hq" || pathname.startsWith("/hq/");

  // GUIDE_HQ_ITEMS is now a group containing Overview + Companies +
  // Week in Review, so filter its children (not itself) by role.
  // Week in Review needs a scoped company — without one, /dashboard
  // resolves to whichever tenant the fallback picks, which reads to
  // the user as "took me to a random company." Hide it until the
  // guide/sysadmin has picked a company from the fleet list.
  const guideHqItems = GUIDE_HQ_ITEMS.flatMap<NavItem>((item) => {
    if (item.kind === "link") return linkVisible(item) ? [item] : [];
    const filteredChildren = item.items.filter((link) => {
      if (!linkVisible(link)) return false;
      if (link.href === "/dashboard" && !showExitScope) return false;
      return true;
    });
    if (filteredChildren.length === 0) return [];
    return [{ ...item, items: filteredChildren }];
  });
  // Bottom-band group is admin-role specific:
  //  - system_admin → "System admin" (Platform dashboard)
  //  - company_admin → "Admin" (Company settings)
  // aims_guides don't get a bottom band; their per-company settings
  // are reached from the Guide HQ → Companies list → click a company.
  const bottomAdminItems: readonly NavItem[] = isSystemAdmin
    ? SYSTEM_ADMIN_BOTTOM_ITEMS
    : userRole === "company_admin"
      ? COMPANY_ADMIN_BOTTOM_ITEMS
      : [];
  // Non-guide/sysadmin users don't get the Guide HQ group, so their
  // Week in Review link is prepended as a top-level entry above
  // Workspace to keep the daily click short.
  const regularUserTop: readonly NavItem[] =
    userRole === "company_admin" || userRole === "team_member"
      ? [WEEK_IN_REVIEW_TOP_LEVEL]
      : [];
  const items: NavItem[] = isSystemAdmin
    ? showExitScope && !onAdminPicker && !onHqSurface
      ? [...guideHqItems, ...subscribedApp, ...bottomAdminItems]
      : [...guideHqItems, ...bottomAdminItems]
    : userRole === "aims_guide"
      ? onHqSurface
        ? [...guideHqItems, ...bottomAdminItems]
        : [...guideHqItems, ...subscribedApp, ...bottomAdminItems]
      : [...regularUserTop, ...subscribedApp, ...bottomAdminItems];

  return (
    <>
      {/* Mobile top strip — hidden on desktop. Slim so it doesn't
          steal vertical space; just the mark + hamburger + user. */}
      <div className={styles.mobileBar}>
        <button
          type="button"
          className={styles.hamburger}
          aria-controls="sidebar-drawer"
          aria-expanded={mobileOpen}
          aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
          onClick={() => setMobileOpen((prev) => !prev)}
        >
          <span aria-hidden="true">{mobileOpen ? "×" : "☰"}</span>
        </button>
        <Link href="/" className={styles.mobileLogoLink} aria-label="AiMS HQ home">
          <Image
            src={LOGO_WHITE_SRC}
            alt="AiMS HQ"
            priority
            width={LOGO_INTRINSIC_WIDTH}
            height={LOGO_INTRINSIC_HEIGHT}
            className={styles.mobileLogo}
          />
        </Link>
      </div>

      <aside
        id="sidebar-drawer"
        className={styles.sidebar}
        data-collapsed={collapsed ? "true" : undefined}
        data-mobile-open={mobileOpen ? "true" : undefined}
        aria-label="Primary"
      >
        <div className={styles.header}>
          <Link href="/" className={styles.logoLink} aria-label="AiMS HQ home">
            <Image
              src={collapsed ? LOGO_MARK_SRC : LOGO_WHITE_SRC}
              alt="AiMS HQ"
              priority
              width={LOGO_INTRINSIC_WIDTH}
              height={LOGO_INTRINSIC_HEIGHT}
              className={styles.logo}
            />
          </Link>
          <button
            type="button"
            className={styles.collapseToggle}
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            aria-pressed={collapsed}
            title={collapsed ? "Expand" : "Collapse"}
          >
            <span aria-hidden="true" className={styles.collapseChevron}>
              {collapsed ? "›" : "‹"}
            </span>
          </button>
        </div>

        {contextLabel ? (
          <div className={styles.contextPill} title={contextLabel}>
            <span className={styles.contextDot} aria-hidden="true" />
            <span className={styles.contextText}>{contextLabel}</span>
          </div>
        ) : null}

        <nav className={styles.nav} aria-label="Primary" ref={navRef}>
          {items.map((item, index) => {
            if (item.kind === "link") {
              return (
                <NavRow
                  key={item.href}
                  href={item.href}
                  icon={item.icon}
                  label={item.label}
                  active={isLinkActive(pathname, item.href)}
                  collapsed={collapsed}
                />
              );
            }
            // In icons-only mode, section grouping is a visual concept
            // only — the label is hidden and we render all children as
            // icons regardless of the group's collapsed state. Toggling
            // groups only makes sense when the labels are visible.
            const groupCollapsed = !collapsed && collapsedGroups.has(item.label);
            const panelId = `nav-group-${item.label.toLowerCase().replace(/\s+/g, "-")}`;
            return (
              <div key={item.label} className={styles.section}>
                {collapsed ? (
                  <>
                    {index > 0 ? (
                      <div className={styles.sectionDivider} aria-hidden="true" />
                    ) : null}
                    {item.items.map((child) => (
                      <NavRow
                        key={child.href}
                        href={child.href}
                        icon={child.icon}
                        label={child.label}
                        active={isLinkActive(pathname, child.href)}
                        collapsed={collapsed}
                      />
                    ))}
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className={styles.sectionLabel}
                      onClick={() => toggleGroup(item.label)}
                      aria-expanded={!groupCollapsed}
                      aria-controls={panelId}
                    >
                      <span>{item.label}</span>
                      <span
                        className={styles.sectionChevron}
                        data-open={!groupCollapsed ? "true" : undefined}
                        aria-hidden="true"
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </span>
                    </button>
                    {!groupCollapsed ? (
                      <div id={panelId}>
                        {item.items.map((child) => (
                          <NavRow
                            key={child.href}
                            href={child.href}
                            icon={child.icon}
                            label={child.label}
                            active={isLinkActive(pathname, child.href)}
                            collapsed={collapsed}
                          />
                        ))}
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            );
          })}
        </nav>

        <div className={styles.footer}>
          <div className={styles.footerBell}>
            <NotificationBell items={[...notifications]} placement="up" />
          </div>
          <SidebarUserMenu
            userName={userName}
            showExitScope={isSystemAdmin && showExitScope}
            scopedCompanyName={scopedCompanyName}
            collapsed={collapsed}
          />
        </div>
      </aside>

      {mobileOpen ? (
        <div
          className={styles.scrim}
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      ) : null}
    </>
  );
}

function NavRow({
  href,
  icon,
  label,
  active,
  collapsed,
}: {
  href: string;
  icon: IconName;
  label: string;
  active: boolean;
  collapsed: boolean;
}) {
  return (
    <Link
      href={href}
      className={styles.navRow}
      data-active={active ? "true" : undefined}
      aria-current={active ? "page" : undefined}
      title={collapsed ? label : undefined}
    >
      <span className={styles.navIcon} aria-hidden="true">
        <Icon name={icon} />
      </span>
      <span className={styles.navLabel}>{label}</span>
    </Link>
  );
}

function isLinkActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function SidebarUserMenu({
  userName,
  showExitScope,
  scopedCompanyName,
  collapsed,
}: {
  userName: string;
  showExitScope: boolean;
  scopedCompanyName?: string;
  collapsed: boolean;
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

  const initials = getInitials(userName);

  return (
    <div className={styles.userSlot} ref={ref}>
      <button
        type="button"
        className={styles.userButton}
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={collapsed ? userName : undefined}
      >
        <span className={styles.userAvatar} aria-hidden="true">
          {initials}
        </span>
        <span className={styles.userName}>{userName}</span>
      </button>

      {open ? (
        <div className={styles.userMenu} role="menu">
          <Link href="/profile" className={styles.userMenuItem} role="menuitem">
            My profile
          </Link>
          {showExitScope ? (
            <form action={exitCompanyScopeAction}>
              <button
                type="submit"
                className={styles.userMenuItem}
                role="menuitem"
              >
                Exit {scopedCompanyName ?? "company"}
              </button>
            </form>
          ) : null}
          <form
            action={signOutAction}
            onSubmit={() => posthog.reset()}
          >
            <button
              type="submit"
              className={styles.userMenuItem}
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

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "·";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ---- Icons ---------------------------------------------------------
// Inline stroke SVGs at 18px, currentColor. One per nav item so the
// rail stays legible when collapsed to icons-only.

type IconName =
  | "dashboard"
  | "doc"
  | "people"
  | "chart"
  | "measure"
  | "calendar"
  | "check"
  | "meeting"
  | "sparkle"
  | "book"
  | "spark"
  | "building"
  | "gauge";

function Icon({ name }: { name: IconName }): ReactNode {
  switch (name) {
    case "dashboard":
      return (
        <Stroke>
          <rect x="3" y="3" width="7" height="9" rx="1.5" />
          <rect x="14" y="3" width="7" height="5" rx="1.5" />
          <rect x="14" y="12" width="7" height="9" rx="1.5" />
          <rect x="3" y="16" width="7" height="5" rx="1.5" />
        </Stroke>
      );
    case "doc":
      return (
        <Stroke>
          <path d="M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
          <path d="M14 3v5h5" />
          <path d="M8 13h8M8 17h5" />
        </Stroke>
      );
    case "people":
      return (
        <Stroke>
          <circle cx="9" cy="8" r="3.5" />
          <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
          <circle cx="17" cy="9" r="2.5" />
          <path d="M15 20a5.5 5.5 0 0 1 6.5-5.4" />
        </Stroke>
      );
    case "chart":
      return (
        <Stroke>
          <circle cx="12" cy="5" r="2.5" />
          <circle cx="5" cy="18" r="2.5" />
          <circle cx="19" cy="18" r="2.5" />
          <path d="M12 7.5v4M12 11.5L6 16M12 11.5L18 16" />
        </Stroke>
      );
    case "measure":
      return (
        <Stroke>
          <path d="M4 20V10M10 20V4M16 20v-8M22 20H2" />
        </Stroke>
      );
    case "calendar":
      return (
        <Stroke>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </Stroke>
      );
    case "check":
      return (
        <Stroke>
          <rect x="3" y="4" width="18" height="17" rx="2" />
          <path d="M8 12l3 3 5-6" />
        </Stroke>
      );
    case "meeting":
      return (
        <Stroke>
          <path d="M4 5h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-4 3v-3H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
          <path d="M8 10h6M8 13h4" />
        </Stroke>
      );
    case "sparkle":
      return (
        <Stroke>
          <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3z" />
          <path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8L19 15z" />
        </Stroke>
      );
    case "book":
      return (
        <Stroke>
          <path d="M4 4h9a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4V4z" />
          <path d="M20 4h-2a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h3V4z" />
        </Stroke>
      );
    case "spark":
      return (
        <Stroke>
          <path d="M12 2v6M12 16v6M2 12h6M16 12h6M5 5l4 4M15 15l4 4M19 5l-4 4M9 15l-4 4" />
        </Stroke>
      );
    case "building":
      return (
        <Stroke>
          <path d="M4 21V6l8-3 8 3v15" />
          <path d="M4 21h16M9 10h.01M15 10h.01M9 14h.01M15 14h.01M9 18h.01M15 18h.01" />
        </Stroke>
      );
    case "gauge":
      // Speedometer arc + needle — reads as "how are we doing?" for
      // the AiMS Scorecard nav item.
      return (
        <Stroke>
          <path d="M4 15a8 8 0 0 1 16 0" />
          <path d="M12 15l4-4" />
          <circle cx="12" cy="15" r="1" />
        </Stroke>
      );
  }
}

function Stroke({ children }: { children: ReactNode }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}
