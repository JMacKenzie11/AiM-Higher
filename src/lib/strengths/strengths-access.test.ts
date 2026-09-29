import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { canEditUserStrengths } from "./strengths-access";

// Who may edit a person's Strengths, stated as tests. The same list
// the user_strengths policies admit after 0242: the subject, a
// system_admin, the subject's company_admin, and a guide assigned to
// the subject's company. Not a colleague, not a guide elsewhere, and
// not a portfolio_admin even with an assignment.

const SUBJECT = { id: "u_1", company_id: "co_a" };
const SELF = { id: "u_1", role: "team_member" as const, company_id: "co_a" };
const PEER = { id: "u_2", role: "team_member" as const, company_id: "co_a" };
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

describe("canEditUserStrengths", () => {
  it("admits the subject, system_admin, their company_admin and their assigned guide", () => {
    expect(canEditUserStrengths(SELF, SUBJECT)).toBe(true);
    expect(canEditUserStrengths(SYS, SUBJECT)).toBe(true);
    expect(canEditUserStrengths(CA, SUBJECT)).toBe(true);
    expect(canEditUserStrengths(GUIDE, SUBJECT)).toBe(true);
  });

  it("refuses a colleague, another company's admin and an unassigned guide", () => {
    expect(canEditUserStrengths(PEER, SUBJECT)).toBe(false);
    expect(canEditUserStrengths(CA_OTHER, SUBJECT)).toBe(false);
    expect(canEditUserStrengths(GUIDE_OTHER, SUBJECT)).toBe(false);
  });

  it("refuses an assigned portfolio_admin, because RLS does", () => {
    expect(canEditUserStrengths(PA_ASSIGNED, SUBJECT)).toBe(false);
  });

  it("refuses everyone but system_admin and the subject for a company-less subject", () => {
    const orphan = { id: "u_9", company_id: null };
    expect(canEditUserStrengths(SYS, orphan)).toBe(true);
    expect(canEditUserStrengths(GUIDE, orphan)).toBe(false);
    expect(canEditUserStrengths(CA, orphan)).toBe(false);
  });
});

// The page-level gates, read as source. These pages are async server
// components and cannot be rendered here, so this pins the two
// decisions of 2026-09-29 that a later tidy-up could quietly undo:
// guides get the admin controls, and they do NOT get the Coach link.
const APP = path.resolve(__dirname, "../../app/(app)");
const read = (rel: string) => readFileSync(path.join(APP, rel), "utf8");
const ROLE_ONLY_IS_ADMIN =
  /const isAdmin =\s*session\.profile\.role === "system_admin" \|\|\s*session\.profile\.role === "company_admin";/;

describe("admin controls admit an assigned guide", () => {
  for (const page of [
    "plan/page.tsx",
    "plan/goal/[id]/page.tsx",
    "plan/sfa/[id]/page.tsx",
    "commitments/page.tsx",
    "people/page.tsx",
    "people/[id]/page.tsx",
    "dashboard/page.tsx",
  ]) {
    it(`${page} does not gate its admin controls on role alone`, () => {
      const src = read(page);
      expect(src).not.toMatch(ROLE_ONLY_IS_ADMIN);
      expect(src).toMatch(/(isAdminForCompany|canAdminCompanyContent)\(/);
    });
  }
});

describe("the Coach link stays with system_admin and company_admin", () => {
  for (const page of ["people/page.tsx", "people/[id]/page.tsx", "dashboard/page.tsx"]) {
    it(`${page} gates Coach on the role-only check, not on the admin helper`, () => {
      const src = read(page);
      expect(src).toMatch(
        /const coachesEveryone =\s*session\.profile\.role === "system_admin" \|\|\s*session\.profile\.role === "company_admin";/
      );
      expect(src).not.toMatch(/\(isAdmin \|\| (person\.reports_to|isManager)/);
      expect(src).not.toMatch(/canManageCompany \|\| (person\.reports_to|managesAnyone)/);
    });
  }
});

describe("Remove from this company is hidden from guides", () => {
  it("people/page.tsx only offers an assignment row's menu to system_admin and company_admin", () => {
    const src = read("people/page.tsx");
    expect(src).toMatch(
      /const canRemoveAssignments =\s*session\.profile\.role === "system_admin" \|\|\s*session\.profile\.role === "company_admin";/
    );
    expect(src).toMatch(/isAdmin && \(!person\.viaAssignment \|\| canRemoveAssignments\)/);
  });
});
