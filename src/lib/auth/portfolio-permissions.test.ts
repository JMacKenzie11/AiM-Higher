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
});

describe("canViewCompany vs isAdminForCompany", () => {
  it("lets a portfolio_admin VIEW any company on the instance", () => {
    expect(canViewCompany(PA, "co_a")).toBe(true);
    expect(canViewCompany(PA, "co_b")).toBe(true);
    // Including one that did not exist when the role was granted.
    expect(canViewCompany(PA, "co_created_later")).toBe(true);
  });

  it("does NOT let a portfolio_admin write content in any of them", () => {
    // This is the assertion that keeps every edit button off. If it
    // ever flips, the app starts offering writes RLS then refuses.
    expect(isAdminForCompany(PA, "co_a")).toBe(false);
    expect(isAdminForCompany(PA, "co_b")).toBe(false);
  });

  it("does not treat a portfolio_admin as an owner of anything", () => {
    // canWriteOwnedRow is the other write gate, used by every
    // commitment path. Admin-or-owner, and this role is neither.
    expect(
      canWriteOwnedRow(PA, { company_id: "co_a", owner_id: "someone" })
    ).toBe(false);
    expect(canWriteOwnedRow(PA, { company_id: "co_a", owner_id: null })).toBe(
      false
    );
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
  it("admits a portfolio_admin to any company, with no assignment list", () => {
    // A guide's reach is a row in guide_assignments. This role has no
    // such table by design (migration 0190), so there is nothing here
    // to consult — which is exactly why every scope-in is recorded.
    expect(() =>
      assertCompanyAccess({ profile: PA }, "co_anything")
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
