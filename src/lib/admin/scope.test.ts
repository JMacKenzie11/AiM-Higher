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

// The scope resolver now verifies that any cookie/assignment-derived
// company is still live (not soft-deleted) before returning it. Under
// test we return a row for every id by default so pre-existing
// invariant tests keep passing; the "deleted company" test below
// swaps this map to return null for a specific id.
const dbMocks = vi.hoisted(() => {
  const deletedIds = new Set<string>();
  return { deletedIds };
});

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, value: string) => ({
          maybeSingle: async () =>
            dbMocks.deletedIds.has(value)
              ? { data: null }
              : { data: { id: value } },
        }),
      }),
    }),
  }),
}));

beforeEach(() => {
  cookieMocks.store.clear();
  dbMocks.deletedIds.clear();
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

  it("routes a sysadmin through their own scope cookie", async () => {
    // The cookie is `<profileId>:<companyId>` since 2026-09-14.
    cookieMocks.store.set("aims_scope_company", "root:co_target");
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

  it("refuses a scope cookie belonging to a different user", async () => {
    // THE INCIDENT, AS A REGRESSION TEST. A newly created
    // portfolio_admin signed in on production and landed inside a
    // company's dashboard without ever pressing a scope-in control,
    // and with no audit row to say they had entered. The cookie was
    // the previous occupant of that browser.
    cookieMocks.store.set("aims_scope_company", "somebody_else:co_target");
    const { getEffectiveCompanyId } = await import("./scope");
    const result = await getEffectiveCompanyId({
      profile: {
        id: "portfolio_1",
        role: "portfolio_admin",
        company_id: null,
        guide_company_ids: [],
      },
    });
    expect(result).toBeNull();
  });

  it("refuses an unbound cookie written before the binding existed", async () => {
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
    expect(result).toBeNull();
  });

  it("refuses another user's cookie for a guide too", async () => {
    // Not a portfolio_admin problem. Every role that reads this cookie
    // could inherit one, and a guide inheriting a scope would land
    // them in a company their assignments may not even cover.
    cookieMocks.store.set("aims_scope_company", "somebody_else:co_a");
    const { getEffectiveCompanyId } = await import("./scope");
    const result = await getEffectiveCompanyId({
      profile: {
        id: "g_1",
        role: "aims_guide",
        company_id: null,
        guide_company_ids: ["co_a", "co_b"],
      },
    });
    // Two assignments, so there is no sole-assignment fallback either.
    expect(result).toBeNull();
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

  it("clears a sysadmin cookie pointing at a soft-deleted company", async () => {
    // The bug this catches: sysadmin scopes into a company, company
    // later gets soft-deleted, sysadmin's cookie still points at the
    // ghost. Without the liveness check, downstream pages read
    // against a tenant that has no members visible (share picker
    // empty, orphan chats resurfacing, etc.).
    cookieMocks.store.set("aims_scope_company", "co_dead");
    dbMocks.deletedIds.add("co_dead");
    const { getEffectiveCompanyId } = await import("./scope");
    const result = await getEffectiveCompanyId({
      profile: {
        id: "root",
        role: "system_admin",
        company_id: null,
        guide_company_ids: [],
      },
    });
    expect(result).toBeNull();
  });
});

// ===============================================================
// home_company_id — a landing preference, never a permission
// ===============================================================
//
// Added with migration 0200. The column answers one question: where
// does the app take a cross-tenant operator when they open it. It is
// read in exactly one branch of the resolver, after the scope cookie,
// and nothing else in the codebase or the database reads it at all.
//
// The tests below are mostly about what it does NOT do. That is the
// point of them: the audit that preceded this design found ten
// policies granting on a company match with no role discrimination,
// three of them writes, which is what killed the original plan of
// putting home into `company_id`. Home in its own column is only safe
// for as long as it stays inert, so the inertness is what gets
// asserted.
describe("home_company_id", () => {
  it("lands a portfolio_admin on their home when no cookie is set", async () => {
    const { getEffectiveCompanyId } = await import("./scope");
    const result = await getEffectiveCompanyId({
      profile: {
        id: "portfolio_1",
        role: "portfolio_admin",
        company_id: null,
        home_company_id: "co_home",
        guide_company_ids: [],
      },
    });
    expect(result).toBe("co_home");
  });

  it("lands a system_admin on their home too", async () => {
    const { getEffectiveCompanyId } = await import("./scope");
    const result = await getEffectiveCompanyId({
      profile: {
        id: "root",
        role: "system_admin",
        company_id: null,
        home_company_id: "co_home",
        guide_company_ids: [],
      },
    });
    expect(result).toBe("co_home");
  });

  it("lets an explicit scope-in beat home", async () => {
    // Home is where you start, not where you are kept. Somebody who
    // has scoped into another company stays there.
    cookieMocks.store.set("aims_scope_company", "portfolio_1:co_target");
    const { getEffectiveCompanyId } = await import("./scope");
    const result = await getEffectiveCompanyId({
      profile: {
        id: "portfolio_1",
        role: "portfolio_admin",
        company_id: null,
        home_company_id: "co_home",
        guide_company_ids: [],
      },
    });
    expect(result).toBe("co_target");
  });

  it("falls back to home when the scope cookie points at a dead company", async () => {
    cookieMocks.store.set("aims_scope_company", "portfolio_1:co_dead");
    dbMocks.deletedIds.add("co_dead");
    const { getEffectiveCompanyId } = await import("./scope");
    const result = await getEffectiveCompanyId({
      profile: {
        id: "portfolio_1",
        role: "portfolio_admin",
        company_id: null,
        home_company_id: "co_home",
        guide_company_ids: [],
      },
    });
    expect(result).toBe("co_home");
  });

  it("returns null when home itself is soft-deleted", async () => {
    // Same reasoning as the dead-cookie case above: a company that
    // reads back null through companies_hide_deleted is a ghost, and
    // landing on it gives empty pickers and orphaned records rather
    // than an error anyone can act on.
    dbMocks.deletedIds.add("co_gone");
    const { getEffectiveCompanyId } = await import("./scope");
    const result = await getEffectiveCompanyId({
      profile: {
        id: "portfolio_1",
        role: "portfolio_admin",
        company_id: null,
        home_company_id: "co_gone",
        guide_company_ids: [],
      },
    });
    expect(result).toBeNull();
  });

  it("does not consult home for an aims_guide", async () => {
    // A guide's scope is their assignment list, and home must not
    // widen it by the back door. Two assignments means no sole-
    // assignment auto-scope, so the answer is the picker, not the
    // home this profile happens to carry.
    const { getEffectiveCompanyId } = await import("./scope");
    const result = await getEffectiveCompanyId({
      profile: {
        id: "g_1",
        role: "aims_guide",
        company_id: null,
        home_company_id: "co_home",
        guide_company_ids: ["co_a", "co_b"],
      },
    });
    expect(result).toBeNull();
  });

  it("does not let home override a company_admin's own company", async () => {
    const { getEffectiveCompanyId } = await import("./scope");
    const result = await getEffectiveCompanyId({
      profile: {
        id: "u_1",
        role: "company_admin",
        company_id: "co_a",
        home_company_id: "co_elsewhere",
        guide_company_ids: [],
      },
    });
    expect(result).toBe("co_a");
  });

  it("does not let home override a team_member's own company", async () => {
    const { getEffectiveCompanyId } = await import("./scope");
    const result = await getEffectiveCompanyId({
      profile: {
        id: "u_2",
        role: "team_member",
        company_id: "co_a",
        home_company_id: "co_elsewhere",
        guide_company_ids: [],
      },
    });
    expect(result).toBe("co_a");
  });

  it("still throws when a company user is handed their home company", async () => {
    // THE INVARIANT, STATED AGAINST THE NEW COLUMN. If home ever
    // became a permission, this is the test that would go green
    // instead of throwing. It must keep throwing.
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
            home_company_id: "co_elsewhere",
            guide_company_ids: [],
          },
        },
        "co_elsewhere"
      )
    ).toThrow(CrossTenantAccessError);
  });

  it("still throws when a guide is handed an unassigned home company", async () => {
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
            home_company_id: "co_elsewhere",
            guide_company_ids: ["co_a"],
          },
        },
        "co_elsewhere"
      )
    ).toThrow(CrossTenantAccessError);
  });

  it("behaves exactly as before when home is absent", async () => {
    // The pre-migration shape: profiles that predate the column, and
    // everybody whose company_id already answers the question. Both
    // read as undefined here, and both must resolve to what they
    // resolved to yesterday.
    const { getEffectiveCompanyId } = await import("./scope");
    const noHome = await getEffectiveCompanyId({
      profile: {
        id: "portfolio_1",
        role: "portfolio_admin",
        company_id: null,
        guide_company_ids: [],
      },
    });
    expect(noHome).toBeNull();

    const nullHome = await getEffectiveCompanyId({
      profile: {
        id: "portfolio_1",
        role: "portfolio_admin",
        company_id: null,
        home_company_id: null,
        guide_company_ids: [],
      },
    });
    expect(nullHome).toBeNull();
  });
});
