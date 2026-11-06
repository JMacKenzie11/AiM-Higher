import { describe, it, expect } from "vitest";
import {
  canWriteOwnedRow,
  isAdminForCompany,
  isFacilitatorFor,
  worksTeamIn,
} from "./permissions";
import { isCompanyRole } from "@/lib/types";
import { docAdmitsRole, filterRoleSections } from "@/lib/help/loader";

// The facilitator (0321), stated as tests: the team's commitments and
// Critical Success Factors in their own company, and nothing an admin
// does beyond that.

const FAC = { id: "fac_1", role: "facilitator" as const, company_id: "co_a" };
const MEMBER = { id: "tm_1", role: "team_member" as const, company_id: "co_a" };

describe("facilitator permissions", () => {
  it("works the team's commitments and measures in their own company", () => {
    expect(isFacilitatorFor(FAC, "co_a")).toBe(true);
    expect(worksTeamIn(FAC, "co_a")).toBe(true);
    expect(canWriteOwnedRow(FAC, { company_id: "co_a", owner_id: "someone_else" })).toBe(true);
    expect(canWriteOwnedRow(FAC, { company_id: "co_a", owner_id: null })).toBe(true);
  });

  it("is not an admin, so people, the plan, the chart and settings stay closed", () => {
    expect(isAdminForCompany(FAC, "co_a")).toBe(false);
  });

  it("reaches nothing in another company", () => {
    expect(worksTeamIn(FAC, "co_b")).toBe(false);
    expect(canWriteOwnedRow(FAC, { company_id: "co_b", owner_id: "someone_else" })).toBe(false);
  });

  it("leaves a team member on their own work", () => {
    expect(worksTeamIn(MEMBER, "co_a")).toBe(false);
    expect(canWriteOwnedRow(MEMBER, { company_id: "co_a", owner_id: "someone_else" })).toBe(false);
    expect(canWriteOwnedRow(MEMBER, { company_id: "co_a", owner_id: "tm_1" })).toBe(true);
  });

  it("is a company role that admins may grant, and the platform roles are not", () => {
    expect(isCompanyRole("facilitator")).toBe(true);
    expect(isCompanyRole("team_member")).toBe(true);
    expect(isCompanyRole("company_admin")).toBe(true);
    expect(isCompanyRole("portfolio_admin")).toBe(false);
    expect(isCompanyRole("system_admin")).toBe(false);
    expect(isCompanyRole("aims_guide")).toBe(false);
  });
});

describe("a facilitator's help", () => {
  const doc = [
    "Shared.",
    "::: role team_member",
    "Member text.",
    ":::",
    "::: role company_admin",
    "Admin text.",
    ":::",
  ].join("\n");

  it("shows the team member blocks when a doc says nothing for facilitators", () => {
    const out = filterRoleSections(doc, "facilitator");
    expect(out).toContain("Member text.");
    expect(out).not.toContain("Admin text.");
  });

  it("shows only the facilitator blocks when a doc has one", () => {
    const withOwn = `${doc}\n::: role company_admin,facilitator\nTeam work.\n:::`;
    const out = filterRoleSections(withOwn, "facilitator");
    expect(out).toContain("Team work.");
    expect(out).not.toContain("Member text.");
    expect(out).not.toContain("Admin text.");
  });

  it("reads a doc meant for team members", () => {
    expect(docAdmitsRole(["team_member"], "facilitator")).toBe(true);
    expect(docAdmitsRole(["company_admin"], "facilitator")).toBe(false);
    expect(docAdmitsRole(null, "facilitator")).toBe(true);
  });
});
