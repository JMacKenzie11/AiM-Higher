import type { Role } from "@/lib/types";
import type { ModuleFeature } from "@/lib/subscriptions/service";

// EVERY PAGE IN THE APP: who can open it, and what it needs.
//
// Aimee links people to pages ("that's on Goals & Priorities"), and a
// link is only worth giving if the person can open it. Before this
// there were four partial lists (the sidebar, the help files, the
// filesystem walk in check:help, and eight requireRole calls) and none
// said who could open what. This is the one list, and a test fails CI
// when a page.tsx is missing from it or an entry names a page that no
// longer exists (registry.test.ts).
//
// WHAT IT IS NOT: the access boundary. Each page still guards itself
// (requireRole, requireProfile, company scope, RLS). This list decides
// what Aimee ADVERTISES; a page she never mentions is still protected,
// and a page she wrongly mentioned would still refuse. The test holds
// each entry's roles to the page's own requireRole where it has one,
// so the two cannot drift apart silently.
//
// Titles and purposes are not repeated here: each page's help file
// already has a title and opens with a one-sentence purpose
// (docs/help/README.md), and pages/index.ts reads them from there.
//
// Fields:
//   pattern   the route, with [params] as the folders name them
//   roles     who can open it; "all" means every role once a company
//             is in scope (system admins, guides and portfolio admins
//             reach company pages through the company picker)
//   feature   the company feature it belongs to, when the sidebar
//             hides it without one. Aimee does not advertise a page
//             the company has not got.
//   link      whether Aimee may link to it. False for record pages
//             (they need an id she does not have), for pages that only
//             redirect, and for action pages like /ask-aimee/new.

export type PageEntry = {
  pattern: string;
  roles: "all" | readonly Role[];
  feature: ModuleFeature | null;
  link: boolean;
  // Only for a linkable page with no help file of its own, whose help
  // comes from a parent's (the loader falls back the same way). Without
  // it two pages would share the parent's title in Aimee's index.
  title?: string;
};

const ADMINS: readonly Role[] = ["system_admin", "company_admin", "aims_guide"];
const ADMINS_AND_PORTFOLIO: readonly Role[] = ["system_admin", "company_admin", "aims_guide", "portfolio_admin"];

export const PAGES: readonly PageEntry[] = [
  // ---- The workspace (sidebar group gated on "execution") ----------
  { pattern: "/scorecard", roles: "all", feature: "execution", link: true },
  { pattern: "/dashboard", roles: "all", feature: "execution", link: true },
  { pattern: "/foundation", roles: "all", feature: "execution", link: true },
  { pattern: "/people", roles: "all", feature: "execution", link: true },
  { pattern: "/people/[id]", roles: "all", feature: "execution", link: false },
  { pattern: "/people/[id]/edit", roles: ["system_admin", "company_admin", "aims_guide"], feature: "execution", link: false },
  { pattern: "/people/[id]/strengths", roles: "all", feature: "strengths", link: false },
  { pattern: "/chart", roles: "all", feature: "execution", link: true },
  { pattern: "/chart/function/[id]", roles: "all", feature: "execution", link: false },
  { pattern: "/chart/function/[id]/role-description", roles: "all", feature: "role_descriptions", link: false },
  { pattern: "/chart/function/[id]/role-description/v/[version]", roles: "all", feature: "role_descriptions", link: false },
  { pattern: "/measures", roles: "all", feature: "execution", link: true },
  { pattern: "/plan", roles: "all", feature: "execution", link: true },
  { pattern: "/plan/goal/[id]", roles: "all", feature: "execution", link: false },
  { pattern: "/plan/priority/[id]", roles: "all", feature: "execution", link: false },
  { pattern: "/plan/sfa/[id]", roles: "all", feature: "execution", link: false },
  { pattern: "/quarters", roles: "all", feature: "execution", link: true },
  { pattern: "/issues", roles: "all", feature: "execution", link: true },
  { pattern: "/commitments", roles: "all", feature: "execution", link: true },
  { pattern: "/leadership", roles: "all", feature: "execution", link: true },
  { pattern: "/leadership/meetings/[id]", roles: "all", feature: "execution", link: false },

  // ---- Resources ----------------------------------------------------
  { pattern: "/ask-aimee", roles: "all", feature: null, link: true },
  { pattern: "/ask-aimee/memory", roles: "all", feature: null, link: true },
  { pattern: "/ask-aimee/new", roles: "all", feature: null, link: false },
  { pattern: "/ask-aimee/[conversationId]", roles: "all", feature: null, link: false },
  { pattern: "/coach/[profileId]", roles: ["system_admin", "company_admin"], feature: null, link: false },
  { pattern: "/coach/[profileId]/[conversationId]", roles: ["system_admin", "company_admin"], feature: null, link: false },
  { pattern: "/classroom", roles: "all", feature: "classroom", link: true },
  { pattern: "/classroom/lessons/[slug]", roles: "all", feature: "classroom", link: false },
  { pattern: "/classroom/lessons/[slug]/[sectionSlug]", roles: "all", feature: "classroom", link: false },
  { pattern: "/classroom/trainings/[slug]", roles: "all", feature: "classroom", link: false },
  { pattern: "/profile", roles: "all", feature: null, link: true },
  { pattern: "/guide/nudge/[id]", roles: "all", feature: null, link: false },

  // ---- Strengths ------------------------------------------------------
  { pattern: "/strengths/welcome", roles: "all", feature: "strengths", link: true, title: "My Strengths assessment" },
  { pattern: "/strengths/assessment", roles: "all", feature: "strengths", link: false },
  { pattern: "/strengths/results", roles: "all", feature: "strengths", link: false },
  { pattern: "/strengths/teams", roles: ADMINS, feature: "strengths", link: true, title: "Strengths teams" },
  { pattern: "/strengths/teams/recommend", roles: ADMINS, feature: "strengths", link: false },
  { pattern: "/strengths/teams/[id]", roles: ADMINS, feature: "strengths", link: false },

  // ---- Oversight ------------------------------------------------------
  { pattern: "/hq", roles: ["aims_guide", "system_admin"], feature: null, link: true },
  { pattern: "/portfolio", roles: ["portfolio_admin", "system_admin"], feature: null, link: true },
  { pattern: "/admin/companies", roles: ADMINS_AND_PORTFOLIO, feature: null, link: true },
  { pattern: "/admin/companies/[id]", roles: ADMINS_AND_PORTFOLIO, feature: null, link: false },
  { pattern: "/admin/transcripts", roles: ["system_admin", "aims_guide"], feature: null, link: false },
  { pattern: "/admin/transcripts/meetings/[id]", roles: ["system_admin", "aims_guide"], feature: null, link: false },

  // ---- System admin ---------------------------------------------------
  { pattern: "/admin/agents", roles: ["system_admin"], feature: null, link: true },
  { pattern: "/admin/classroom", roles: ["system_admin"], feature: null, link: true },
  { pattern: "/admin/classroom/lessons/[id]/edit", roles: ["system_admin"], feature: null, link: false },
  { pattern: "/admin/classroom/trainings/[id]/edit", roles: ["system_admin"], feature: null, link: false },
  { pattern: "/admin/dashboard", roles: ["system_admin"], feature: null, link: true },
  { pattern: "/admin/guides/[guideId]/hq", roles: ["system_admin"], feature: null, link: false },
];

export function canRoleOpen(entry: PageEntry, role: Role): boolean {
  return entry.roles === "all" || entry.roles.includes(role);
}

// The pages a person may be sent to: open to their role, and part of a
// feature their company has (or of none).
export function linkablePagesFor(role: Role, features: readonly ModuleFeature[]): PageEntry[] {
  return PAGES.filter(
    (p) => p.link && canRoleOpen(p, role) && (p.feature === null || features.includes(p.feature))
  );
}

// The help files a page's title and purpose may come from, most specific
// first: the same slugs, and the same fallback to a parent, as the help
// loader (every [param] becomes _id, "/" becomes ".").
export function helpSlugsFor(pattern: string): string[] {
  const parts = pattern.replace(/^\//, "").replace(/\[[^\]]+\]/g, "_id").split("/").filter(Boolean);
  const out: string[] = [];
  for (let end = parts.length; end > 0; end--) out.push(parts.slice(0, end).join("."));
  return out;
}

// Every page a person can open, as route patterns, for the chat's link
// check: an internal link in one of Aimee's replies is only drawn as a
// link when it matches one of these (ChatView). Record pages count here
// (they are openable, just not advertised), so a link Aimee was given
// by a tool, like a meeting's own page, still works.
export function openablePatternsFor(role: Role, features: readonly ModuleFeature[]): string[] {
  return PAGES.filter(
    (p) => canRoleOpen(p, role) && (p.feature === null || features.includes(p.feature))
  ).map((p) => p.pattern);
}

// Does a path (no query, no hash) match one of the route patterns? A
// [param] matches exactly one segment.
export function pathMatchesPattern(path: string, patterns: readonly string[]): boolean {
  const clean = path.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  return patterns.some((pattern) => {
    const re = new RegExp(
      // Escape everything but the brackets, then turn each [param]
      // into one path segment.
      "^" + pattern.replace(/[.*+?^${}()|\\]/g, "\\$&").replace(/\[[^\]]+\]/g, "[^/]+") + "$"
    );
    return re.test(clean);
  });
}

// How the chat draws a link in one of Aimee's replies: an in-app link
// to a page the person can open, plain text for an in-app link they
// cannot open, and an outside link as it is. Pure, so the check can be
// tested without rendering (ChatView calls it).
export function linkDecision(
  href: string | undefined,
  openablePatterns: readonly string[] | undefined
): "in-app" | "text" | "outside" {
  const target = href ?? "";
  if (!target.startsWith("/") || target.startsWith("//")) return "outside";
  if (openablePatterns && !pathMatchesPattern(target, openablePatterns)) return "text";
  return "in-app";
}
