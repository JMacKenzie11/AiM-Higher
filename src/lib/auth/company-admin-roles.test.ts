import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COMPANY_ADMIN_ROLES, isAdminForCompany } from "./permissions";

// A portfolio admin a system admin switched on as a company's admin
// may do everything that company's company_admin can (Jason,
// 2026-11-09). These surfaces used to decide "admin" by role alone,
// which left the switched-on portfolio admin (and, on some, an
// assigned guide) out. The source checks keep a role-only check from
// coming back on them.

const root = join(__dirname, "..", "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("COMPANY_ADMIN_ROLES", () => {
  it("is the four roles that can hold a company's admin powers", () => {
    expect([...COMPANY_ADMIN_ROLES].sort()).toEqual(
      ["aims_guide", "company_admin", "portfolio_admin", "system_admin"]
    );
  });
});

describe("isAdminForCompany, for a portfolio admin", () => {
  const pa = (switchedOn: string[]) => ({
    id: "pa_1",
    role: "portfolio_admin" as const,
    company_id: null,
    portfolio_company_ids: ["co_a", "co_b"],
    portfolio_admin_company_ids: switchedOn,
  });

  it("admits one switched on as this company's admin", () => {
    expect(isAdminForCompany(pa(["co_a"]), "co_a")).toBe(true);
  });

  it("refuses one only assigned here, or switched on elsewhere", () => {
    expect(isAdminForCompany(pa([]), "co_a")).toBe(false);
    expect(isAdminForCompany(pa(["co_b"]), "co_a")).toBe(false);
  });
});

// Actions whose first door was the three-role list without
// portfolio_admin. Each now opens with COMPANY_ADMIN_ROLES and leaves
// the company to isAdminForCompany or RLS.
const ACTIONS = [
  "src/lib/plan/priority-actions.ts",
  "src/lib/plan/goal-actions.ts",
  "src/lib/plan/sfa-actions.ts",
  "src/lib/plan/cascade-actions.ts",
  "src/lib/plan/bulk-reset-action.ts",
  "src/lib/foundation/actions.ts",
  "src/lib/scorecard/actions.ts",
  "src/lib/people/actions.ts",
  "src/lib/auth/users.ts",
];

describe("company admin actions admit the switched-on portfolio admin", () => {
  it.each(ACTIONS)("%s has no three-role requireRole left", (file) => {
    const src = read(file);
    expect(src).not.toMatch(
      /requireRole\(\[\s*"system_admin",\s*"company_admin",\s*"aims_guide",?\s*\]\)/
    );
  });

  it.each([
    "src/lib/plan/priority-actions.ts",
    "src/lib/plan/goal-actions.ts",
    "src/lib/plan/sfa-actions.ts",
    "src/lib/scorecard/actions.ts",
  ])("%s decides admin per company, not by role", (file) => {
    const src = read(file);
    expect(src).not.toMatch(/role === "company_admin" &&\s*\n?\s*session\.profile\.company_id ===/);
    expect(src).toContain("isAdminForCompany(session.profile,");
  });
});

// Pages whose `isAdmin` was system_admin || company_admin by role.
const PAGES = [
  "src/app/(app)/plan/PlanView.tsx",
  "src/app/(app)/plan/goal/[id]/page.tsx",
  "src/app/(app)/plan/sfa/[id]/page.tsx",
  "src/app/(app)/people/page.tsx",
  "src/app/(app)/people/[id]/page.tsx",
  "src/app/(app)/dashboard/page.tsx",
];

describe("company admin pages ask isAdminForCompany", () => {
  it.each(PAGES)("%s has no role-only isAdmin", (file) => {
    const src = read(file);
    expect(src).not.toMatch(
      /const isAdmin =\s*session\.profile\.role === "system_admin" \|\|\s*session\.profile\.role === "company_admin";/
    );
    expect(src).toContain("isAdminForCompany(session.profile,");
  });

  it("the edit page lets in whoever isAdminForCompany admits", () => {
    const src = read("src/app/(app)/people/[id]/edit/page.tsx");
    expect(src).not.toContain('const isCompanyAdmin = session.profile.role === "company_admin"');
    expect(src).toContain("isAdminForCompany(session.profile, subject.company_id)");
  });

  it("the strengths editor follows isAdminForCompany", () => {
    expect(read("src/app/(app)/people/[id]/strengths/page.tsx")).toContain(
      "isAdminForCompany(session.profile, subject.company_id)"
    );
    expect(read("src/lib/strengths/user-strengths.ts")).toContain(
      "isAdminForCompany(session.profile, target.company_id)"
    );
  });

  it("company settings gives the champion and Start over cards to a switched-on portfolio admin", () => {
    const src = read("src/app/(app)/admin/companies/[id]/page.tsx");
    expect(src).toContain("const championCard = isSystemAdmin || actsAsCompanyAdmin;");
    expect(src).toContain("const startOverCard = (isSystemAdmin || actsAsCompanyAdmin) && hasResettable;");
  });
});

// Editing, inviting and deleting a person writes through the
// service-role client, so the scope check there is the boundary.
// Creating stays open to every portfolio admin in any company (item 3
// of the closed list); acting on an existing person does not.
describe("auth/users.ts scope checks", () => {
  const src = read("src/lib/auth/users.ts");
  const fn = (name: string) => {
    const start = src.indexOf(`function ${name}(`);
    expect(start).toBeGreaterThan(-1);
    return src.slice(start, src.indexOf("\n}\n", start));
  };

  it("canManageProfileIn has no blanket portfolio_admin branch", () => {
    expect(fn("canManageProfileIn")).not.toContain('"portfolio_admin"');
    expect(fn("canManageProfileIn")).toContain("isAdminForCompany(profile, targetCompanyId)");
  });

  it("canCreateProfileIn keeps every portfolio admin able to staff a company", () => {
    expect(fn("canCreateProfileIn")).toContain('if (profile.role === "portfolio_admin") return true;');
  });

  it("only createUserAction asks canCreateProfileIn", () => {
    expect(src.match(/canCreateProfileIn\(session\.profile/g)?.length).toBe(1);
  });
});
