import { describe, it, expect, beforeEach, vi } from "vitest";

// Unit tests for the multi-tenant scope invariant. This module holds
// the load-bearing backstop that prevents a company user from being
// routed to another tenant's data through any bug: assertCompanyAccess
// throws CrossTenantAccessError if the resolver ever tries to hand a
// company_admin or team_member a company_id that isn't their own.
//
// If any test in this file starts failing, it means the security belt
// was weakened — treat it as a P0.

// The scope module reads cookies via next/headers. Mock a stable cookie
// jar so tests can control the scope cookie without touching real HTTP.
const cookieMocks = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    store,
    jar: {
      get: (name: string) => {
        const value = store.get(name);
        return value !== undefined ? { name, value } : undefined;
      },
      set: (name: string, value: string) => {
        store.set(name, value);
      },
    },
  };
});

vi.mock("next/headers", () => ({
  cookies: async () => cookieMocks.jar,
}));

beforeEach(() => {
  cookieMocks.store.clear();
});

// ===============================================================
// assertCompanyAccess — the security invariant
// ===============================================================
describe("assertCompanyAccess", () => {
  it("allows a company_admin to access their own company", async () => {
    const { assertCompanyAccess } = await import("./scope");
    expect(() =>
      assertCompanyAccess(
        {
          profile: {
            id: "u_1",
            role: "company_admin",
            company_id: "co_a",
            guide_company_ids: [],
          },
        },
        "co_a"
      )
    ).not.toThrow();
  });

  it("allows a team_member to access their own company", async () => {
    const { assertCompanyAccess } = await import("./scope");
    expect(() =>
      assertCompanyAccess(
        {
          profile: {
            id: "u_2",
            role: "team_member",
            company_id: "co_a",
            guide_company_ids: [],
          },
        },
        "co_a"
      )
    ).not.toThrow();
  });

  it("THROWS when a company_admin tries to access a different company", async () => {
    const { assertCompanyAccess, CrossTenantAccessError } = await import(
      "./scope"
    );
    expect(() =>
      assertCompanyAccess(
        {
          profile: {
            id: "u_1",
            role: "company_admin",
            company_id: "co_a",
            guide_company_ids: [],
          },
        },
        "co_b"
      )
    ).toThrow(CrossTenantAccessError);
  });

  it("THROWS when a team_member tries to access a different company", async () => {
    // The paramount case: a bug must never silently serve a team
    // member another tenant's data. This is why the belt exists.
    const { assertCompanyAccess, CrossTenantAccessError } = await import(
      "./scope"
    );
    expect(() =>
      assertCompanyAccess(
        {
          profile: {
            id: "u_2",
            role: "team_member",
            company_id: "co_a",
            guide_company_ids: [],
          },
        },
        "co_b"
      )
    ).toThrow(CrossTenantAccessError);
  });

  it("THROWS when a company user has no company_id at all", async () => {
    // Would only happen via a data corruption / seed bug, but the
    // invariant should still fail loud rather than silently permit
    // any company access.
    const { assertCompanyAccess, CrossTenantAccessError } = await import(
      "./scope"
    );
    expect(() =>
      assertCompanyAccess(
        {
          profile: {
            id: "u_3",
            role: "team_member",
            company_id: null,
            guide_company_ids: [],
          },
        },
        "co_a"
      )
    ).toThrow(CrossTenantAccessError);
  });

  it("allows a system_admin unconditionally", async () => {
    const { assertCompanyAccess } = await import("./scope");
    expect(() =>
      assertCompanyAccess(
        {
          profile: {
            id: "root",
            role: "system_admin",
            company_id: null,
            guide_company_ids: [],
          },
        },
        "co_anything"
      )
    ).not.toThrow();
  });

  it("allows an aims_guide when the target is in their assignments", async () => {
    const { assertCompanyAccess } = await import("./scope");
    expect(() =>
      assertCompanyAccess(
        {
          profile: {
            id: "g_1",
            role: "aims_guide",
            company_id: null,
            guide_company_ids: ["co_a", "co_b"],
          },
        },
        "co_b"
      )
    ).not.toThrow();
  });

  it("THROWS for an aims_guide targeting an unassigned company", async () => {
    const { assertCompanyAccess, CrossTenantAccessError } = await import(
      "./scope"
    );
    expect(() =>
      assertCompanyAccess(
        {
          profile: {
            id: "g_1",
            role: "aims_guide",
            company_id: null,
            guide_company_ids: ["co_a"],
          },
        },
        "co_b"
      )
    ).toThrow(CrossTenantAccessError);
  });

  it("carries diagnostic fields on the thrown error", async () => {
    const { assertCompanyAccess, CrossTenantAccessError } = await import(
      "./scope"
    );
    try {
      assertCompanyAccess(
        {
          profile: {
            id: "u_leak",
            role: "team_member",
            company_id: "co_a",
            guide_company_ids: [],
          },
        },
        "co_b"
      );
      throw new Error("Expected assertCompanyAccess to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(CrossTenantAccessError);
      if (err instanceof CrossTenantAccessError) {
        expect(err.profileId).toBe("u_leak");
        expect(err.ownCompanyId).toBe("co_a");
        expect(err.attemptedCompanyId).toBe("co_b");
        expect(err.role).toBe("team_member");
      }
    }
  });
});

// ===============================================================
// getEffectiveCompanyId — runs the assertion on every resolve
// ===============================================================
describe("getEffectiveCompanyId (invariant coverage)", () => {
  it("returns the company user's own company_id and passes the assertion", async () => {
    const { getEffectiveCompanyId } = await import("./scope");
    const result = await getEffectiveCompanyId({
      profile: {
        id: "u_1",
        role: "company_admin",
        company_id: "co_a",
        guide_company_ids: [],
      },
    });
    expect(result).toBe("co_a");
  });

  it("ignores the scope cookie for company users (defense-in-depth)", async () => {
    // A team_member's session with a stale/planted scope cookie for
    // some other company MUST NOT be routed to that company. The
    // resolver returns profile.company_id first; the assertion would
    // catch any regression.
    cookieMocks.store.set("aims_scope_company", "co_other");
    const { getEffectiveCompanyId } = await import("./scope");
    const result = await getEffectiveCompanyId({
      profile: {
        id: "u_1",
        role: "team_member",
        company_id: "co_a",
        guide_company_ids: [],
      },
    });
    expect(result).toBe("co_a");
  });

  it("routes a sysadmin through the scope cookie", async () => {
    cookieMocks.store.set("aims_scope_company", "co_target");
    const { getEffectiveCompanyId } = await import("./scope");
    const result = await getEffectiveCompanyId({
      profile: {
        id: "root",
        role: "system_admin",
        company_id: null,
        guide_company_ids: [],
      },
    });
    expect(result).toBe("co_target");
  });

  it("auto-scopes a guide to their sole assignment when no cookie is set", async () => {
    const { getEffectiveCompanyId } = await import("./scope");
    const result = await getEffectiveCompanyId({
      profile: {
        id: "g_1",
        role: "aims_guide",
        company_id: null,
        guide_company_ids: ["co_only"],
      },
    });
    expect(result).toBe("co_only");
  });

  it("returns null for a guide with no cookie and multiple assignments", async () => {
    const { getEffectiveCompanyId } = await import("./scope");
    const result = await getEffectiveCompanyId({
      profile: {
        id: "g_2",
        role: "aims_guide",
        company_id: null,
        guide_company_ids: ["co_a", "co_b"],
      },
    });
    expect(result).toBeNull();
  });

  it("ignores a stale scope cookie for a guide unassigned to that company", async () => {
    cookieMocks.store.set("aims_scope_company", "co_unassigned");
    const { getEffectiveCompanyId } = await import("./scope");
    const result = await getEffectiveCompanyId({
      profile: {
        id: "g_1",
        role: "aims_guide",
        company_id: null,
        guide_company_ids: ["co_a"],
      },
    });
    // Single-assignment auto-scope: still lands on co_a, not the
    // planted cookie.
    expect(result).toBe("co_a");
  });
});
