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
  it("sees the fleet list and the portfolio when unscoped", () => {
    // Companies was added to every cross-tenant role, so "only the
    // portfolio" became "the portfolio and the way into a company".
    // What the claim still holds is the absence of `app`: a
    // company-scoped link with no company behind it is a link to an
    // error, which is asserted below and in the next test.
    expect(navBandsFor(ctx({ role: "portfolio_admin" }))).toEqual([
      "companies",
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
    ).toEqual(["companies", "portfolio"]);
  });

  it("adds the company's surfaces and settings once scoped in", () => {
    expect(
      navBandsFor(ctx({ role: "portfolio_admin", scopedIntoCompany: true }))
    ).toEqual(["companies", "portfolio", "app", "portfolioBottom"]);
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
  it("gives system_admin the portfolio band, after Guide HQ", () => {
    // NARROWED DELIBERATELY. This asserted system_admin was "exactly
    // as it was" when portfolio_admin arrived, which was right then
    // and is a decision now reversed: /portfolio always admitted a
    // system_admin and the Overview link always carried their role,
    // so the missing band made the page reachable by typing the URL
    // and by nothing else.
    //
    // What the test still pins is the ORDER. Guide HQ leads, because
    // that is where a system_admin lands and works; the portfolio is
    // the instance read across every company and is their second
    // home, not their first.
    expect(
      navBandsFor(ctx({ role: "system_admin", scopedIntoCompany: true }))
    ).toEqual(["companies", "guideHq", "portfolio", "app", "systemAdminBottom"]);
    expect(navBandsFor(ctx({ role: "system_admin" }))).toEqual([
      "companies",
      "guideHq",
      "portfolio",
      "systemAdminBottom",
    ]);
    expect(
      navBandsFor(
        ctx({ role: "system_admin", scopedIntoCompany: true, onHqSurface: true })
      )
    ).toEqual(["companies", "guideHq", "portfolio", "systemAdminBottom"]);
    expect(
      navBandsFor(
        ctx({
          role: "system_admin",
          scopedIntoCompany: true,
          onAdminPicker: true,
        })
      )
    ).toEqual(["companies", "guideHq", "portfolio", "systemAdminBottom"]);
  });

  it("gives aims_guide the fleet list, and otherwise leaves them be", () => {
    expect(navBandsFor(ctx({ role: "aims_guide" }))).toEqual([
      "companies",
      "guideHq",
      "app",
    ]);
    expect(
      navBandsFor(ctx({ role: "aims_guide", onHqSurface: true }))
    ).toEqual(["companies", "guideHq"]);
  });

  it("gives no company-bound role the fleet list", () => {
    // The other half of the change. Companies went to every
    // cross-tenant role and to nobody else: /admin/companies lists
    // every company on the instance, which is not a thing a company
    // admin or a team member has any business seeing.
    for (const role of ["company_admin", "team_member"]) {
      for (const scoped of [true, false]) {
        expect(
          navBandsFor(ctx({ role, scopedIntoCompany: scoped }))
        ).not.toContain("companies");
      }
    }
  });

  it("leaves company_admin and team_member exactly as they were", () => {
    expect(navBandsFor(ctx({ role: "company_admin" }))).toEqual([
      "app",
      "companyAdminBottom",
    ]);
    expect(navBandsFor(ctx({ role: "team_member" }))).toEqual(["app"]);
  });

  it("gives no role below a cross-tenant one a portfolio band", () => {
    // system_admin left this list when they gained the band. The
    // claim is still worth keeping for the roles it still covers:
    // a guide, a company admin and a team member have no business on
    // a page that reads every company on the instance.
    for (const role of ["aims_guide", "company_admin", "team_member"]) {
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
