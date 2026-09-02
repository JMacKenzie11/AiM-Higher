import { describe, it, expect } from "vitest";
import {
  autoScopeTarget,
  companyIdFromPath,
  isPrefetchRequest,
  roleCanAutoScope,
} from "./scope-request";

// Pins the middleware's URL-driven scope-in behaviour. The bug this
// guards against: Next.js Link prefetches on /hq, /admin/dashboard
// and /admin/companies hit /admin/companies/<id> through middleware
// and rewrote the sysadmin's scope cookie to whichever company was
// prefetched last. A prefetch must never move the operator.

const CO_A = "11111111-1111-4111-8111-111111111111";
const CO_B = "22222222-2222-4222-8222-222222222222";

describe("companyIdFromPath", () => {
  it("extracts the id from /admin/companies/<uuid>", () => {
    expect(companyIdFromPath(`/admin/companies/${CO_A}`)).toBe(CO_A);
    expect(companyIdFromPath(`/admin/companies/${CO_A}/`)).toBe(CO_A);
    expect(companyIdFromPath(`/admin/companies/${CO_A}/anything`)).toBe(CO_A);
  });

  it("returns null for the picker, non-uuid ids, and unrelated paths", () => {
    expect(companyIdFromPath("/admin/companies")).toBeNull();
    expect(companyIdFromPath("/admin/companies/")).toBeNull();
    expect(companyIdFromPath("/admin/companies/new")).toBeNull();
    expect(companyIdFromPath("/dashboard")).toBeNull();
    expect(companyIdFromPath(`/people/${CO_A}`)).toBeNull();
  });
});

describe("isPrefetchRequest", () => {
  it("detects the Next.js app-router prefetch header", () => {
    const h = new Headers({ "next-router-prefetch": "1" });
    expect(isPrefetchRequest(h)).toBe(true);
  });

  it("detects browser Purpose / Sec-Purpose prefetch hints", () => {
    expect(isPrefetchRequest(new Headers({ purpose: "prefetch" }))).toBe(true);
    expect(
      isPrefetchRequest(new Headers({ "sec-purpose": "prefetch" }))
    ).toBe(true);
    expect(
      isPrefetchRequest(new Headers({ "sec-purpose": "prefetch;prerender" }))
    ).toBe(true);
  });

  it("treats an ordinary navigation (RSC or document) as not a prefetch", () => {
    expect(isPrefetchRequest(new Headers())).toBe(false);
    expect(isPrefetchRequest(new Headers({ rsc: "1" }))).toBe(false);
    expect(
      isPrefetchRequest(new Headers({ "sec-purpose": "navigate" }))
    ).toBe(false);
  });
});

describe("roleCanAutoScope", () => {
  it("admits only cross-tenant roles", () => {
    expect(roleCanAutoScope("system_admin")).toBe(true);
    expect(roleCanAutoScope("aims_guide")).toBe(true);
    expect(roleCanAutoScope("company_admin")).toBe(false);
    expect(roleCanAutoScope("team_member")).toBe(false);
    expect(roleCanAutoScope(null)).toBe(false);
  });
});

describe("autoScopeTarget", () => {
  it("scopes into the company on a real navigation to its admin page", () => {
    expect(
      autoScopeTarget({
        pathname: `/admin/companies/${CO_A}`,
        currentScope: null,
        isPrefetch: false,
      })
    ).toBe(CO_A);
    expect(
      autoScopeTarget({
        pathname: `/admin/companies/${CO_B}`,
        currentScope: CO_A,
        isPrefetch: false,
      })
    ).toBe(CO_B);
  });

  it("NEVER moves the scope on a prefetch, even to a different company", () => {
    // The regression: five company links in the /hq viewport each
    // prefetch through middleware; the last response to land used
    // to win the cookie. A prefetch must leave the cookie alone.
    expect(
      autoScopeTarget({
        pathname: `/admin/companies/${CO_B}`,
        currentScope: CO_A,
        isPrefetch: true,
      })
    ).toBeNull();
    expect(
      autoScopeTarget({
        pathname: `/admin/companies/${CO_B}`,
        currentScope: null,
        isPrefetch: true,
      })
    ).toBeNull();
  });

  it("is a no-op when already scoped to that company", () => {
    expect(
      autoScopeTarget({
        pathname: `/admin/companies/${CO_A}`,
        currentScope: CO_A,
        isPrefetch: false,
      })
    ).toBeNull();
  });

  it("is a no-op on any path that isn't a company admin page", () => {
    expect(
      autoScopeTarget({ pathname: "/hq", currentScope: CO_A, isPrefetch: false })
    ).toBeNull();
    expect(
      autoScopeTarget({
        pathname: "/admin/companies",
        currentScope: CO_A,
        isPrefetch: false,
      })
    ).toBeNull();
  });
});
