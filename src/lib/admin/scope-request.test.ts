import { describe, it, expect } from "vitest";

import {
  SCOPE_PICKER_PATH,
  companyIdFromPath,
  needsScopePicker,
  roleUsesCompanyScope,
  scopePickerPathFor,
} from "./scope-request";

// These used to assert that middleware skipped its scope-cookie WRITE
// when a request looked like a prefetch. That model is gone, and with
// it the reason those tests existed.
//
// Middleware no longer writes the cookie at all. Scope-in is
// scopeIntoCompany in scope-actions.ts, invoked by a button. So the
// property to pin is no longer "which requests are exempt from the
// write" but "no request writes it, and an operator who asks for a
// company they are not in gets sent to pick one".

const CO_A = "11111111-1111-4111-8111-111111111111";
const CO_B = "22222222-2222-4222-8222-222222222222";

describe("companyIdFromPath", () => {
  it("extracts the id from a company admin path", () => {
    expect(companyIdFromPath(`/admin/companies/${CO_A}`)).toBe(CO_A);
    expect(companyIdFromPath(`/admin/companies/${CO_A}/`)).toBe(CO_A);
    expect(companyIdFromPath(`/admin/companies/${CO_A}/anything`)).toBe(CO_A);
  });

  it("returns null for anything that isn't one", () => {
    expect(companyIdFromPath("/admin/companies")).toBeNull();
    expect(companyIdFromPath("/admin/companies/")).toBeNull();
    expect(companyIdFromPath("/admin/companies/new")).toBeNull();
    expect(companyIdFromPath("/dashboard")).toBeNull();
    expect(companyIdFromPath(`/people/${CO_A}`)).toBeNull();
  });
});

describe("roleUsesCompanyScope", () => {
  it("is true only for the cross-tenant roles", () => {
    expect(roleUsesCompanyScope("system_admin")).toBe(true);
    expect(roleUsesCompanyScope("aims_guide")).toBe(true);
    expect(roleUsesCompanyScope("company_admin")).toBe(false);
    expect(roleUsesCompanyScope("team_member")).toBe(false);
    expect(roleUsesCompanyScope(null)).toBe(false);
  });
});

describe("needsScopePicker", () => {
  it("sends a cross-tenant operator to the picker when scoped nowhere", () => {
    expect(
      needsScopePicker({
        pathname: `/admin/companies/${CO_A}`,
        currentScope: null,
        role: "system_admin",
      }),
    ).toBe(true);
  });

  it("sends them to the picker when scoped somewhere else", () => {
    // The page would otherwise render against CO_B while the URL says
    // CO_A, which is the confusing half of the old behaviour.
    expect(
      needsScopePicker({
        pathname: `/admin/companies/${CO_A}`,
        currentScope: CO_B,
        role: "system_admin",
      }),
    ).toBe(true);
  });

  it("lets a deep link through when they are already scoped into it", () => {
    // The case that matters: scope in, navigate around, paste the URL
    // to a colleague who is also scoped in.
    expect(
      needsScopePicker({
        pathname: `/admin/companies/${CO_A}`,
        currentScope: CO_A,
        role: "system_admin",
      }),
    ).toBe(false);
    expect(
      needsScopePicker({
        pathname: `/admin/companies/${CO_A}/anything`,
        currentScope: CO_A,
        role: "aims_guide",
      }),
    ).toBe(false);
  });

  it("never touches company users, whatever the cookie says", () => {
    // company_admin and team_member resolve their company from their
    // own profile row and ignore the cookie entirely, so their
    // navigation has to be completely unaffected by any of this.
    for (const role of ["company_admin", "team_member", null]) {
      for (const currentScope of [null, CO_A, CO_B]) {
        expect(
          needsScopePicker({
            pathname: `/admin/companies/${CO_A}`,
            currentScope,
            role,
          }),
        ).toBe(false);
      }
    }
  });

  it("ignores every path that isn't a specific company", () => {
    for (const pathname of [
      "/",
      "/hq",
      "/dashboard",
      "/admin/companies",
      "/admin/dashboard",
      "/plan",
    ]) {
      expect(
        needsScopePicker({ pathname, currentScope: null, role: "system_admin" }),
      ).toBe(false);
    }
  });

  it("points at Guide HQ", () => {
    expect(SCOPE_PICKER_PATH).toBe("/hq");
  });
});

describe("the scope cookie is no longer a GET side effect", () => {
  it("exposes nothing that could decide to write it", async () => {
    // The regression guard. autoScopeTarget returned the company a GET
    // should scope the caller into, and isPrefetchRequest was the
    // (unreliable) exemption in front of it. Both are gone, and this
    // module must never grow a write decision again: scope-in is a
    // server action, and a request must not be able to change who the
    // caller is acting as.
    const mod = await import("./scope-request");
    expect(Object.keys(mod).sort()).toEqual([
      "SCOPE_PICKER_PATH",
      "companyIdFromPath",
      "needsScopePicker",
      "roleUsesCompanyScope",
      // Reads a role and returns a path. Decides WHERE to send a
      // caller who is being bounced, never whether to write anything.
      "scopePickerPathFor",
    ]);
  });
});

// ---- portfolio_admin ------------------------------------------
describe("portfolio_admin scope routing", () => {
  it("carries a scope cookie like the other cross-tenant roles", () => {
    // Without this, a portfolio_admin deep-linking a company page
    // while scoped elsewhere would render it against their cookie
    // rather than against the company in the URL.
    expect(roleUsesCompanyScope("portfolio_admin")).toBe(true);
  });

  it("is bounced to the picker for a company it is not scoped into", () => {
    expect(
      needsScopePicker({
        pathname: "/admin/companies/11111111-1111-4111-8111-111111111111",
        currentScope: "22222222-2222-4222-8222-222222222222",
        role: "portfolio_admin",
      })
    ).toBe(true);
  });

  it("is not bounced when already scoped into that company", () => {
    expect(
      needsScopePicker({
        pathname: "/admin/companies/11111111-1111-4111-8111-111111111111",
        currentScope: "11111111-1111-4111-8111-111111111111",
        role: "portfolio_admin",
      })
    ).toBe(false);
  });

  it("picks companies, not Guide HQ", () => {
    // /hq admits aims_guide and system_admin only. Sending a
    // portfolio_admin there is a redirect loop, not a picker.
    expect(scopePickerPathFor("portfolio_admin")).toBe("/admin/companies");
    expect(scopePickerPathFor("system_admin")).toBe("/hq");
    expect(scopePickerPathFor("aims_guide")).toBe("/hq");
  });
});
