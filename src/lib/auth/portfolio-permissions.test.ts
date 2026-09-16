import { describe, it, expect } from "vitest";
import {
  canViewCompany,
  isAdminForCompany,
  isPortfolioAdmin,
  canWriteOwnedRow,
} from "./permissions";
import { assertCompanyAccess, CrossTenantAccessError } from "@/lib/admin/scope";

// The shape of portfolio_admin, stated as tests.
//
// WIDE READ, NARROW WRITE. The two helpers that decide this are
// isAdminForCompany (may this caller WRITE here) and canViewCompany
// (may this caller SEE this company). Every content surface in the
// app computes its edit affordance from the first, which is why the
// UI goes read-only for this role without a single page being
// changed — and why the pair must not be collapsed into one helper
// for tidiness.

const PA = { id: "pa_1", role: "portfolio_admin" as const, company_id: null };
// The same role, holding one assignment. Decision 1: a portfolio
// admin who wants to run one of their companies can, and one who
// does not, does not — so both shapes are real and both are tested.
const PA_ASSIGNED = {
  id: "pa_2",
  role: "portfolio_admin" as const,
  company_id: null,
  portfolio_company_ids: ["co_a"],
};
const SYS = { id: "sys_1", role: "system_admin" as const, company_id: null };
const CA = { id: "ca_1", role: "company_admin" as const, company_id: "co_a" };
const GUIDE = {
  id: "g_1",
  role: "aims_guide" as const,
  company_id: null,
  guide_company_ids: ["co_a"],
};

describe("isPortfolioAdmin", () => {
  it("is true only for the role", () => {
    expect(isPortfolioAdmin(PA)).toBe(true);
    for (const p of [SYS, CA, GUIDE]) expect(isPortfolioAdmin(p)).toBe(false);
  });

  it("does not depend on assignments in either direction", () => {
    // The role and the assignment answer different questions, and
    // this helper answers the role one. An assigned holder is no more
    // a portfolio admin than an unassigned one.
    expect(isPortfolioAdmin(PA_ASSIGNED)).toBe(true);
  });
});

describe("canViewCompany vs isAdminForCompany", () => {
  it("lets a portfolio_admin VIEW any company on the instance", () => {
    expect(canViewCompany(PA, "co_a")).toBe(true);
    expect(canViewCompany(PA, "co_b")).toBe(true);
    // Including one that did not exist when the role was granted.
    expect(canViewCompany(PA, "co_created_later")).toBe(true);
  });

  it("does NOT let an UNASSIGNED portfolio_admin write content anywhere", () => {
    // This is the assertion that keeps every edit button off, and it
    // is now conditional on assignments rather than on the role.
    // Narrowed deliberately in the same change that added the
    // portfolio branch to isAdminForCompany: before assignments
    // existed this was true of the role, and it is still true of
    // every company the caller holds no row for.
    expect(isAdminForCompany(PA, "co_a")).toBe(false);
    expect(isAdminForCompany(PA, "co_b")).toBe(false);
    // Including companies somebody ELSE is assigned to. The list on
    // the session is the caller's own, read back through a policy
    // that only ever returns their rows.
    expect(isAdminForCompany(PA, "co_assigned_to_another")).toBe(false);
  });

  it("lets an ASSIGNED portfolio_admin write content in that company", () => {
    expect(isAdminForCompany(PA_ASSIGNED, "co_a")).toBe(true);
  });

  it("stops at the edge of the assignment", () => {
    // An assignment is per-company, not a switch that turns the role
    // into a company admin everywhere. co_b is on the same instance
    // and readable by this caller; it is not writable.
    expect(isAdminForCompany(PA_ASSIGNED, "co_b")).toBe(false);
    expect(canViewCompany(PA_ASSIGNED, "co_b")).toBe(true);
  });

  it("treats a missing list as no assignments, not as all of them", () => {
    // The field is optional on SessionProfileLike, so an absent one
    // must fail closed. A caller built without it is a caller with
    // nothing, never a caller with everything.
    const noList = {
      id: "pa_3",
      role: "portfolio_admin" as const,
      company_id: null,
    };
    expect(isAdminForCompany(noList, "co_a")).toBe(false);
  });

  it("does not treat an unassigned portfolio_admin as an owner of anything", () => {
    // canWriteOwnedRow is the other write gate, used by every
    // commitment path. Admin-or-owner, and an unassigned caller is
    // neither.
    expect(
      canWriteOwnedRow(PA, { company_id: "co_a", owner_id: "someone" })
    ).toBe(false);
    expect(canWriteOwnedRow(PA, { company_id: "co_a", owner_id: null })).toBe(
      false
    );
  });

  it("carries the assignment through canWriteOwnedRow", () => {
    // It delegates to isAdminForCompany, so it inherits the branch
    // rather than repeating it. Asserted anyway, because "inherits
    // it" is a claim about a call site and this is the call site.
    expect(
      canWriteOwnedRow(PA_ASSIGNED, { company_id: "co_a", owner_id: "someone" })
    ).toBe(true);
    expect(
      canWriteOwnedRow(PA_ASSIGNED, { company_id: "co_b", owner_id: "someone" })
    ).toBe(false);
  });

  it("changes nothing for the roles that already existed", () => {
    expect(canViewCompany(SYS, "co_b")).toBe(true);
    expect(canViewCompany(CA, "co_a")).toBe(true);
    expect(canViewCompany(CA, "co_b")).toBe(false);
    expect(canViewCompany(GUIDE, "co_a")).toBe(true);
    expect(canViewCompany(GUIDE, "co_b")).toBe(false);
  });
});

describe("assertCompanyAccess", () => {
  it("admits a portfolio_admin to any company, assignment or not", () => {
    // There IS an assignment table now (0199), and this function
    // still does not consult it. assertCompanyAccess is the read
    // backstop: it asks whose data a request may SEE, and this role
    // sees the instance. The assignment decides writing, which is
    // isAdminForCompany's question and is asserted above.
    //
    // Every scope-in is still recorded in portfolio_admin_events,
    // and that record is still what stands in for a list here.
    expect(() =>
      assertCompanyAccess({ profile: PA }, "co_anything")
    ).not.toThrow();
    expect(() =>
      assertCompanyAccess({ profile: PA_ASSIGNED }, "co_unassigned")
    ).not.toThrow();
  });

  it("still refuses a guide a company outside their caseload", () => {
    expect(() => assertCompanyAccess({ profile: GUIDE }, "co_a")).not.toThrow();
    expect(() => assertCompanyAccess({ profile: GUIDE }, "co_b")).toThrow(
      CrossTenantAccessError
    );
  });

  it("still refuses a company_admin another tenant", () => {
    expect(() => assertCompanyAccess({ profile: CA }, "co_b")).toThrow(
      CrossTenantAccessError
    );
  });
});
