import { describe, it, expect } from "vitest";
import { navBandsFor, type NavContext } from "./nav-bands";

// The nav inventory, as assertions.
//
// The question this file answers: which roles reach which surfaces
// from the rail. It is the courtesy layer — RLS decides what they can
// actually do — but a nav that offers a role a page it will be
// redirected off is a nav that lies, and this is where that gets
// caught.

const ctx = (over: Partial<NavContext>): NavContext => ({
  role: "team_member",
  scopedIntoCompany: false,
  onHqSurface: false,
  onPortfolioSurface: false,
  onAdminPicker: false,
  ...over,
});

describe("portfolio_admin", () => {
  it("sees only the portfolio when unscoped", () => {
    expect(navBandsFor(ctx({ role: "portfolio_admin" }))).toEqual([
      "portfolio",
    ]);
  });

  it("sees only the portfolio while standing on it", () => {
    // Company-scoped links with no company behind them are links to
    // an error, and on /portfolio there is deliberately no scope.
    expect(
      navBandsFor(
        ctx({
          role: "portfolio_admin",
          scopedIntoCompany: true,
          onPortfolioSurface: true,
        })
      )
    ).toEqual(["portfolio"]);
  });

  it("adds the company's surfaces and settings once scoped in", () => {
    expect(
      navBandsFor(ctx({ role: "portfolio_admin", scopedIntoCompany: true }))
    ).toEqual(["portfolio", "app", "portfolioBottom"]);
  });

  it("never sees Guide HQ or the platform tools", () => {
    // The two bands that would appear if this role fell through to
    // the system_admin branch — which it would, because the Sidebar's
    // isSystemAdmin prop is really "is cross-tenant".
    for (const scoped of [true, false]) {
      for (const onHq of [true, false]) {
        const bands = navBandsFor(
          ctx({
            role: "portfolio_admin",
            scopedIntoCompany: scoped,
            onHqSurface: onHq,
          })
        );
        expect(bands).not.toContain("guideHq");
        expect(bands).not.toContain("systemAdminBottom");
        expect(bands).not.toContain("companyAdminBottom");
      }
    }
  });
});

describe("the roles that already existed", () => {
  it("leaves system_admin exactly as it was", () => {
    expect(
      navBandsFor(ctx({ role: "system_admin", scopedIntoCompany: true }))
    ).toEqual(["guideHq", "app", "systemAdminBottom"]);
    expect(navBandsFor(ctx({ role: "system_admin" }))).toEqual([
      "guideHq",
      "systemAdminBottom",
    ]);
    expect(
      navBandsFor(
        ctx({ role: "system_admin", scopedIntoCompany: true, onHqSurface: true })
      )
    ).toEqual(["guideHq", "systemAdminBottom"]);
    expect(
      navBandsFor(
        ctx({
          role: "system_admin",
          scopedIntoCompany: true,
          onAdminPicker: true,
        })
      )
    ).toEqual(["guideHq", "systemAdminBottom"]);
  });

  it("leaves aims_guide exactly as it was", () => {
    expect(navBandsFor(ctx({ role: "aims_guide" }))).toEqual([
      "guideHq",
      "app",
    ]);
    expect(
      navBandsFor(ctx({ role: "aims_guide", onHqSurface: true }))
    ).toEqual(["guideHq"]);
  });

  it("leaves company_admin and team_member exactly as they were", () => {
    expect(navBandsFor(ctx({ role: "company_admin" }))).toEqual([
      "app",
      "companyAdminBottom",
    ]);
    expect(navBandsFor(ctx({ role: "team_member" }))).toEqual(["app"]);
  });

  it("gives no role but portfolio_admin a portfolio band", () => {
    for (const role of [
      "system_admin",
      "aims_guide",
      "company_admin",
      "team_member",
    ]) {
      for (const scoped of [true, false]) {
        expect(
          navBandsFor(ctx({ role, scopedIntoCompany: scoped }))
        ).not.toContain("portfolio");
      }
    }
  });

  it("gives no role but portfolio_admin the scoped-settings band", () => {
    for (const role of [
      "system_admin",
      "aims_guide",
      "company_admin",
      "team_member",
    ]) {
      expect(
        navBandsFor(ctx({ role, scopedIntoCompany: true }))
      ).not.toContain("portfolioBottom");
    }
  });
});
