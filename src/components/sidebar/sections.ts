import type { Role } from "@/lib/types";
import { simplifyOn, type SimplifyChange } from "@/lib/ui/simplify";

// THE SIDEBAR'S SECTIONS (simplification review, change 4, the
// "nav-sections" switch).
//
// Ten Workspace links, plus Resources and Strengths, became a handful
// of sections, each a group of pages that belong together. The sidebar
// shows each section as a heading with its pages listed under it, so
// every page is one click from anywhere (Jason, 2026-10-19: a section
// that linked only to its first page hid Issues and the Functional
// Chart from anyone who did not already know where they lived). Every
// page in a section also shows the section's pages as tabs at the foot
// of its header (SectionTabs). Pure data and pure functions, so
// who sees which section and tab is tested by calling these, the same
// way nav-bands.ts is.
//
// The Strengths assessment moves to the account menu, which is where
// a person goes for things about themselves rather than the company's
// work. Ask Aimee and Classroom are in the sidebar, the first and last
// links under Home (Sidebar.tsx; Jason, 2026-10-30).

export type SectionFeature = "execution" | "strengths" | "classroom";

// The sidebar's icon for each page, one per destination, as the
// sidebar has always had (Sidebar.tsx IconName).
export type SectionIcon =
  | "dashboard" | "gauge" | "meeting" | "check" | "lightbulb" | "measure"
  | "calendar" | "doc" | "chart" | "people" | "group" | "gear";

export type SectionTab = {
  label: string;
  href: string;
  icon: SectionIcon;
  // Absent: every role that sees the section.
  roles?: readonly Role[];
  // Absent: no module needed beyond the section's own.
  feature?: SectionFeature;
  // A page that exists only while its own simplification switch is on.
  requires?: SimplifyChange;
};

export type Section = {
  key: "home" | "meeting" | "work" | "plan" | "team" | "settings";
  label: string;
  icon: "dashboard" | "meeting" | "check" | "calendar" | "people" | "gear";
  feature: SectionFeature | null;
  roles?: readonly Role[];
  tabs: readonly SectionTab[];
};

const ADMINISH: readonly Role[] = ["system_admin", "company_admin", "aims_guide", "portfolio_admin"];

export const SECTIONS: readonly Section[] = [
  {
    key: "home",
    label: "Home",
    icon: "dashboard",
    feature: "execution",
    tabs: [
      // A team member's Home is My week under its own switch; the tab
      // keeps one name for both so the row does not change under them.
      { label: "This week", href: "/dashboard", icon: "dashboard" },
      // How the practice is landing: an admin's and a guide's question.
      { label: "AiMS Implementation", href: "/scorecard", icon: "gauge", roles: ADMINISH },
    ],
  },
  {
    key: "meeting",
    label: "Meeting",
    icon: "meeting",
    feature: "execution",
    tabs: [
      { label: "Run the meeting", href: "/meeting", icon: "meeting", requires: "meeting-mode" },
      { label: "Meeting Summaries", href: "/leadership", icon: "meeting" },
    ],
  },
  {
    key: "work",
    label: "Work",
    icon: "check",
    feature: "execution",
    tabs: [
      { label: "Commitments", href: "/commitments", icon: "check" },
      { label: "Issues", href: "/issues", icon: "lightbulb" },
      { label: "Critical Success Factors", href: "/measures", icon: "measure" },
    ],
  },
  {
    key: "plan",
    label: "Plan",
    icon: "calendar",
    feature: "execution",
    tabs: [
      { label: "Goals & Priorities", href: "/plan", icon: "calendar" },
      { label: "One-Page Plan", href: "/foundation", icon: "doc" },
      { label: "Functional Chart", href: "/chart", icon: "chart" },
    ],
  },
  {
    key: "team",
    label: "Team",
    icon: "people",
    feature: "execution",
    tabs: [
      { label: "People", href: "/people", icon: "people" },
      { label: "Strengths", href: "/strengths/teams", icon: "group", feature: "strengths" },
    ],
  },
  {
    key: "settings",
    label: "Settings",
    icon: "gear",
    feature: null,
    // A company admin's own company. Guides and system admins reach a
    // company's settings from Companies, as they do now; a portfolio
    // admin keeps its own band (nav-bands.ts).
    roles: ["company_admin"],
    tabs: [{ label: "Company settings", href: "/admin/companies", icon: "gear" }],
  },
];

function allowed(
  item: { roles?: readonly Role[]; feature?: SectionFeature | null; requires?: SimplifyChange },
  role: Role,
  features: readonly string[]
) {
  if (item.requires && !simplifyOn(item.requires)) return false;
  if (item.roles && !item.roles.includes(role)) return false;
  if (item.feature && !features.includes(item.feature)) return false;
  return true;
}

// The tabs this person sees in a section.
export function visibleTabs(section: Section, role: Role, features: readonly string[]): SectionTab[] {
  return section.tabs.filter((t) => allowed(t, role, features));
}

// The sections this person sees, each with at least one tab.
export function visibleSections(role: Role, features: readonly string[]): Section[] {
  return SECTIONS.filter((s) => allowed(s, role, features) && visibleTabs(s, role, features).length > 0);
}

function onTab(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

// The section a path belongs to, if any: the one with a tab at or
// above it. /plan/priority/<id> is in Plan; /hq is in none.
export function sectionFor(pathname: string): Section | null {
  return SECTIONS.find((s) => s.tabs.some((t) => onTab(pathname, t.href))) ?? null;
}

export function activeTab(pathname: string, tabs: readonly SectionTab[]): SectionTab | null {
  return tabs.find((t) => onTab(pathname, t.href)) ?? null;
}

// Strengths' own pages all sit under /strengths, but only the team
// view is a tab; the assessment is personal and lives in the account
// menu. A /strengths path other than /strengths/teams is in no section.
export function sectionForPath(pathname: string): Section | null {
  if (pathname.startsWith("/strengths") && !onTab(pathname, "/strengths/teams")) return null;
  return sectionFor(pathname);
}
