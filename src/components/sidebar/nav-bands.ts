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
  // Guide HQ: Overview + the fleet list. aims_guide and system_admin.
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
  onHqSurface: boolean;
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
    // nothing else. Company-scoped links with no company behind them
    // are links to an error.
    if (!ctx.scopedIntoCompany || ctx.onPortfolioSurface) return ["portfolio"];
    return ["portfolio", "app", "portfolioBottom"];
  }

  if (ctx.role === "system_admin") {
    return ctx.scopedIntoCompany && !ctx.onAdminPicker && !ctx.onHqSurface
      ? ["guideHq", "app", "systemAdminBottom"]
      : ["guideHq", "systemAdminBottom"];
  }

  if (ctx.role === "aims_guide") {
    return ctx.onHqSurface ? ["guideHq"] : ["guideHq", "app"];
  }

  if (ctx.role === "company_admin") return ["app", "companyAdminBottom"];

  return ["app"];
}
