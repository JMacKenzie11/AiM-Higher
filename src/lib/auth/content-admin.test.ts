import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as permissions from "./permissions";

// Admin controls on company CONTENT (Plan and Commitments) are for
// system_admin, the company's company_admin and an assigned guide.
// Not for a portfolio_admin, even one assigned to the company (Jason,
// 2026-09-29): isAdminForCompany admits them, so these surfaces ask
// canAdminCompanyContent instead.

type Helpers = {
  canAdminCompanyContent: (
    p: permissions.SessionProfileLike,
    companyId: string
  ) => boolean;
  canWriteOwnedContent: (
    p: permissions.SessionProfileLike,
    row: { company_id: string; owner_id: string | null }
  ) => boolean;
};
const helpers = permissions as unknown as Partial<Helpers>;

const SYS = { id: "sys_1", role: "system_admin" as const, company_id: null };
const CA = { id: "ca_1", role: "company_admin" as const, company_id: "co_a" };
const CA_OTHER = { id: "ca_2", role: "company_admin" as const, company_id: "co_b" };
const GUIDE = {
  id: "g_1",
  role: "aims_guide" as const,
  company_id: null,
  guide_company_ids: ["co_a"],
};
const GUIDE_OTHER = {
  id: "g_2",
  role: "aims_guide" as const,
  company_id: null,
  guide_company_ids: ["co_b"],
};
const PA_ASSIGNED = {
  id: "pa_1",
  role: "portfolio_admin" as const,
  company_id: null,
  portfolio_company_ids: ["co_a"],
};
const MEMBER = { id: "m_1", role: "team_member" as const, company_id: "co_a" };

describe("canAdminCompanyContent", () => {
  it("admits system_admin, the company's company_admin and an assigned guide", () => {
    const f = helpers.canAdminCompanyContent;
    expect(typeof f).toBe("function");
    expect(f?.(SYS, "co_a")).toBe(true);
    expect(f?.(CA, "co_a")).toBe(true);
    expect(f?.(GUIDE, "co_a")).toBe(true);
  });

  it("refuses a portfolio_admin assigned to the company", () => {
    // The point of the helper: isAdminForCompany says yes here.
    expect(permissions.isAdminForCompany(PA_ASSIGNED, "co_a")).toBe(true);
    expect(helpers.canAdminCompanyContent?.(PA_ASSIGNED, "co_a")).toBe(false);
  });

  it("refuses another company's admin, an unassigned guide and a team member", () => {
    const f = helpers.canAdminCompanyContent;
    expect(f?.(CA_OTHER, "co_a")).toBe(false);
    expect(f?.(GUIDE_OTHER, "co_a")).toBe(false);
    expect(f?.(MEMBER, "co_a")).toBe(false);
  });
});

describe("canWriteOwnedContent", () => {
  const theirs = { company_id: "co_a", owner_id: "m_1" };
  const unassigned = { company_id: "co_a", owner_id: null };

  it("gives an assigned guide the admin reach over other people's rows", () => {
    expect(helpers.canWriteOwnedContent?.(GUIDE, theirs)).toBe(true);
    expect(helpers.canWriteOwnedContent?.(GUIDE, unassigned)).toBe(true);
  });

  it("gives an assigned portfolio_admin only their own rows", () => {
    expect(helpers.canWriteOwnedContent?.(PA_ASSIGNED, theirs)).toBe(false);
    expect(helpers.canWriteOwnedContent?.(PA_ASSIGNED, unassigned)).toBe(false);
    expect(
      helpers.canWriteOwnedContent?.(PA_ASSIGNED, { company_id: "co_a", owner_id: "pa_1" })
    ).toBe(true);
  });

  it("keeps the owner path for a team member", () => {
    expect(helpers.canWriteOwnedContent?.(MEMBER, theirs)).toBe(true);
    expect(helpers.canWriteOwnedContent?.(MEMBER, unassigned)).toBe(false);
  });
});

// The pages are async server components and cannot be rendered here,
// so their gating is pinned as source: each computes its admin flag
// from canAdminCompanyContent, and none offers per-row admin reach
// through canWriteOwnedRow (which admits an assigned portfolio_admin).
const APP = path.resolve(__dirname, "../../app/(app)");
const read = (rel: string) => readFileSync(path.join(APP, rel), "utf8");

describe("Plan and Commitments gate admin controls on canAdminCompanyContent", () => {
  for (const page of [
    "plan/page.tsx",
    "plan/goal/[id]/page.tsx",
    "plan/sfa/[id]/page.tsx",
    "plan/priority/[id]/page.tsx",
    "commitments/page.tsx",
  ]) {
    it(`${page}`, () => {
      const src = read(page);
      expect(src).toMatch(/const isAdmin = canAdminCompanyContent\(/);
      expect(src).not.toMatch(/isAdminForCompany\(/);
      expect(src).not.toMatch(/canWriteOwnedRow\(/);
    });
  }
});
