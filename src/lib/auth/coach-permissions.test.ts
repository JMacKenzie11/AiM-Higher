import { describe, it, expect } from "vitest";
import { canCoachAbout } from "./permissions";

// Who may start a coaching conversation about someone (0261, open data
// phase E). The about branch of coaching_conversations_insert says the
// same; the harness case "coach · anyone in the company" proves it.

const subject = { id: "s", company_id: "co" };

describe("canCoachAbout", () => {
  it("admits anyone in the person's company, whatever their role", () => {
    expect(canCoachAbout({ id: "p", role: "team_member", company_id: "co" }, subject)).toBe(true);
    expect(canCoachAbout({ id: "p", role: "company_admin", company_id: "co" }, subject)).toBe(true);
  });

  it("refuses someone in another company", () => {
    expect(canCoachAbout({ id: "p", role: "team_member", company_id: "other" }, subject)).toBe(false);
    expect(canCoachAbout({ id: "p", role: "company_admin", company_id: "other" }, subject)).toBe(false);
  });

  it("admits a system admin, an assigned guide, and a switched-on portfolio admin", () => {
    expect(canCoachAbout({ id: "p", role: "system_admin", company_id: null }, subject)).toBe(true);
    expect(canCoachAbout({ id: "p", role: "aims_guide", company_id: null, guide_company_ids: ["co"] }, subject)).toBe(true);
    expect(
      canCoachAbout(
        { id: "p", role: "portfolio_admin", company_id: null, portfolio_company_ids: ["co"], portfolio_admin_company_ids: ["co"] },
        subject
      )
    ).toBe(true);
  });

  it("refuses a guide elsewhere and a portfolio admin only assigned", () => {
    expect(canCoachAbout({ id: "p", role: "aims_guide", company_id: null, guide_company_ids: ["other"] }, subject)).toBe(false);
    expect(
      canCoachAbout(
        { id: "p", role: "portfolio_admin", company_id: null, portfolio_company_ids: ["co"], portfolio_admin_company_ids: [] },
        subject
      )
    ).toBe(false);
  });

  it("refuses yourself, and someone with no company", () => {
    expect(canCoachAbout({ id: "s", role: "company_admin", company_id: "co" }, subject)).toBe(false);
    expect(canCoachAbout({ id: "p", role: "system_admin", company_id: null }, { id: "s", company_id: null })).toBe(false);
  });
});
