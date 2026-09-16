// Which nav bands a caller sees, as a pure decision.
//
// EXTRACTED SO IT CAN BE TESTED. The vitest environment is `node`,
// with no DOM, so a rendered-sidebar assertion is not available. The
// choice is between testing this by reading the source with a regex
// and testing it by calling it. Calling it is better, and the only
// thing standing in the way was that the decision lived inside a
// 600-line client component alongside React state.
//
// It answers with band NAMES rather than nav items, so the test is
// about who sees what rather than about the contents of a link list
// that changes whenever a page is added.

export type NavBand =
  // The fleet list, on its own at the very top. Every cross-tenant
  // role gets it: a system_admin, an aims_guide and a portfolio
  // admin all work across companies and all need the way in.
  //
  // It used to live INSIDE the Guide HQ group, which hid it from a
  // portfolio admin twice over — that band is not theirs, and the
  // link's own role list left them out as well. They had no route to
  // a company's settings page except by already being scoped into it.
  | "companies"
  // Guide HQ: Overview. aims_guide and system_admin.
  | "guideHq"
  // Portfolio: the portfolio owner's single home link.
  | "portfolio"
  // The currently-scoped company's own surfaces.
  | "app"
  // Platform tools. system_admin only.
  | "systemAdminBottom"
  // A company admin's route to their own settings.
  | "companyAdminBottom"
  // A scoped portfolio admin's route to THIS company's settings.
  | "portfolioBottom";

export type NavContext = {
  role: string;
  // True when a scope cookie is set and the caller is a role that
  // uses one. The Sidebar receives this as `showExitScope`.
  scopedIntoCompany: boolean;
  onPortfolioSurface: boolean;
  onAdminPicker: boolean;
};

export function navBandsFor(ctx: NavContext): NavBand[] {
  // portfolio_admin is decided FIRST, and the order is load-bearing.
  //
  // The Sidebar's `isSystemAdmin` prop is really "is a cross-tenant
  // role" — the layout passes isCrossCompanyRole into it — so this
  // role arrives with it true. Deciding on it before that check is
  // what keeps them off Guide HQ and off the Platform dashboard,
  // neither of which is theirs.
  if (ctx.role === "portfolio_admin") {
    // Unscoped, or standing on /portfolio itself: the portfolio and
    // nothing else beyond the fleet list. Company-scoped links with
    // no company behind them are links to an error.
    if (!ctx.scopedIntoCompany || ctx.onPortfolioSurface) {
      return ["companies", "portfolio"];
    }
    return ["companies", "portfolio", "app", "portfolioBottom"];
  }

  // BEING SCOPED IS BEING SCOPED, WHEREVER YOU ARE STANDING.
  //
  // Guide HQ used to hide the company's pages: /hq once cleared the
  // scope cookie outright, that broke clicking Dashboard from HQ
  // (it redirected straight back, no scope), and the August fix kept
  // the cookie and hid the links by pathname instead.
  //
  // The result was three things disagreeing on one screen. The pill
  // said "SYSTEM ADMIN · B&B ELECTRIC", the user menu offered "Exit
  // B&B Electric", and the nav offered no way into B&B Electric at
  // all — so somebody who landed on Guide HQ while scoped was told
  // where they were and given nothing to do about it. The only route
  // back in was Companies, and scoping again.
  //
  // The surface you are standing on no longer suppresses the app
  // band, so onHqSurface is gone from the context entirely rather
  // than left as an input nothing reads. onAdminPicker stays and
  // still suppresses, because /admin/companies is where you CHOOSE a
  // company: showing the current one's pages beside the list you are
  // picking from is the confusion that screen exists to resolve.
  if (ctx.role === "system_admin") {
    // The portfolio band, after Guide HQ rather than instead of it.
    //
    // /portfolio has always admitted a system_admin — requireRole on
    // the page lists them — and the Overview link has always carried
    // their role. Only the BAND left them out, so the page was
    // reachable by typing the URL and by nothing else. A surface you
    // can only reach if you already know it exists is not a surface.
    //
    // It stays their second home, not their first: a system_admin
    // lands on /hq, and Guide HQ leads. The portfolio view is the
    // instance read across every company, which is worth having and
    // is not where they work.
    return ctx.scopedIntoCompany && !ctx.onAdminPicker
      ? ["companies", "guideHq", "portfolio", "app", "systemAdminBottom"]
      : ["companies", "guideHq", "portfolio", "systemAdminBottom"];
  }

  // A guide has no scope cookie of their own to check here — the
  // Sidebar passes showExitScope, which is true for them exactly
  // when they are working inside one of their companies — so the
  // same rule applies: if they are in a company, its pages are in
  // the nav.
  if (ctx.role === "aims_guide") {
    return ctx.scopedIntoCompany && !ctx.onAdminPicker
      ? ["companies", "guideHq", "app"]
      : ["companies", "guideHq"];
  }

  if (ctx.role === "company_admin") return ["app", "companyAdminBottom"];

  return ["app"];
}
