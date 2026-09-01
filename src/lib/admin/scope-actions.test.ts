import { describe, it, expect, beforeEach, vi } from "vitest";

// Server-action tests for src/lib/admin/scope-actions.ts. These
// actions call redirect() (which throws Next's internal redirect
// signal) instead of returning — the tests catch that throw so they
// can assert what URL was navigated to AND what side effects (cookie
// set, cookie cleared) fired first. The guide-assignment guard is the
// security-critical branch: an aims_guide must never be able to scope
// into a company they aren't assigned to.

// ---- Shared spies + fakes -------------------------------------
const REDIRECT_SIGNAL = Symbol("NEXT_REDIRECT");

const mocks = vi.hoisted(() => {
  const requireRole = vi.fn();
  const revalidatePath = vi.fn();
  const setScopedCompanyCookie = vi.fn();
  const clearScopedCompanyCookie = vi.fn();
  // Target ids the fake Supabase treats as soft-deleted (or missing).
  // Tests toggle entries in this set to exercise the guard.
  const missingCompanyIds = new Set<string>();
  // redirect() throws in real Next; the test spy records the target
  // AND throws a marker so callers get the same non-return behavior.
  const redirect = vi.fn((url: string) => {
    throw { __redirect: true, url };
  });
  return {
    requireRole,
    revalidatePath,
    setScopedCompanyCookie,
    clearScopedCompanyCookie,
    redirect,
    missingCompanyIds,
  };
});

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("@/lib/auth/current-user", () => ({
  requireRole: mocks.requireRole,
}));

vi.mock("./scope", () => ({
  setScopedCompanyCookie: mocks.setScopedCompanyCookie,
  clearScopedCompanyCookie: mocks.clearScopedCompanyCookie,
}));

// scopeIntoCompanyAction now verifies the target company is still
// live (not soft-deleted). Under test, every id resolves to a live
// row unless the test explicitly registers it in missingCompanyIds.
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, value: string) => ({
          maybeSingle: async () =>
            mocks.missingCompanyIds.has(value)
              ? { data: null }
              : { data: { id: value } },
        }),
      }),
    }),
  }),
}));

// ---- Helpers --------------------------------------------------
type RedirectMarker = { __redirect: true; url: string };

// scopeIntoCompanyAction is typed `Promise<never>` — it always throws
// (redirect signal). captureRedirect wraps the call so tests can
// inspect the target URL without the throw leaking as an unhandled
// rejection.
async function captureRedirect(
  fn: () => Promise<unknown>
): Promise<string> {
  try {
    await fn();
  } catch (err) {
    if (err && typeof err === "object" && "__redirect" in err) {
      return (err as RedirectMarker).url;
    }
    throw err;
  }
  throw new Error("Expected a redirect but the action returned normally.");
}

function sysAdminSession() {
  return { profile: { id: "root", role: "system_admin", company_id: null } };
}

function guideSession(assignments: string[]) {
  return {
    profile: {
      id: "guide_1",
      role: "aims_guide",
      company_id: null,
      guide_company_ids: assignments,
    },
  };
}

// ==============================================================
// scopeIntoCompanyAction
// ==============================================================
describe("scopeIntoCompanyAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.missingCompanyIds.clear();
    // Restore the throwing behavior after vi.clearAllMocks() wipes
    // implementations. Without this, redirect becomes a noop and
    // captureRedirect's "expected a redirect" assertion trips.
    mocks.redirect.mockImplementation((url: string) => {
      throw { __redirect: true, url };
    });
  });

  it("scopes a system_admin into any company and defaults the redirect to /dashboard", async () => {
    mocks.requireRole.mockResolvedValue(sysAdminSession());
    const { scopeIntoCompanyAction } = await import("./scope-actions");

    const target = await captureRedirect(() =>
      scopeIntoCompanyAction("co_target")
    );

    expect(target).toBe("/dashboard");
    expect(mocks.setScopedCompanyCookie).toHaveBeenCalledWith(
      "co_target",
      "system_admin"
    );
  });

  it("respects an explicit redirectTo argument", async () => {
    mocks.requireRole.mockResolvedValue(sysAdminSession());
    const { scopeIntoCompanyAction } = await import("./scope-actions");

    const target = await captureRedirect(() =>
      scopeIntoCompanyAction("co_target", "/plan")
    );

    expect(target).toBe("/plan");
  });

  it("allows an aims_guide to scope into a company they're assigned to", async () => {
    mocks.requireRole.mockResolvedValue(
      guideSession(["co_acme", "co_meridian"])
    );
    const { scopeIntoCompanyAction } = await import("./scope-actions");

    const target = await captureRedirect(() =>
      scopeIntoCompanyAction("co_meridian")
    );

    expect(target).toBe("/dashboard");
    expect(mocks.setScopedCompanyCookie).toHaveBeenCalledWith(
      "co_meridian",
      "aims_guide"
    );
  });

  it("bounces an aims_guide who isn't assigned to the target company — no cookie is set", async () => {
    // This is the security-critical path: a guide MUST NOT be able to
    // scope into a company that isn't on their assignment list. The
    // action bounces to /admin/companies BEFORE calling
    // setScopedCompanyCookie.
    mocks.requireRole.mockResolvedValue(guideSession(["co_acme"]));
    const { scopeIntoCompanyAction } = await import("./scope-actions");

    const target = await captureRedirect(() =>
      scopeIntoCompanyAction("co_forbidden")
    );

    expect(target).toBe("/admin/companies");
    expect(mocks.setScopedCompanyCookie).not.toHaveBeenCalled();
  });

  it("bounces an aims_guide with an empty assignments list", async () => {
    // Edge case: guide row exists but the join table returned nothing.
    // Same guard as above — no cookie, redirect to picker.
    mocks.requireRole.mockResolvedValue(guideSession([]));
    const { scopeIntoCompanyAction } = await import("./scope-actions");

    const target = await captureRedirect(() =>
      scopeIntoCompanyAction("co_target")
    );

    expect(target).toBe("/admin/companies");
    expect(mocks.setScopedCompanyCookie).not.toHaveBeenCalled();
  });

  it("bounces a sysadmin when the target company is soft-deleted", async () => {
    // Prevents the "sysadmin scoped into a ghost tenant" bug that
    // stranded chats on since-deleted companies. RLS hides the row,
    // the action sees null on the freshness probe, and bounces to
    // the picker instead of setting a stale cookie.
    mocks.requireRole.mockResolvedValue(sysAdminSession());
    mocks.missingCompanyIds.add("co_ghost");
    const { scopeIntoCompanyAction } = await import("./scope-actions");

    const target = await captureRedirect(() =>
      scopeIntoCompanyAction("co_ghost")
    );

    expect(target).toBe("/admin/companies");
    expect(mocks.setScopedCompanyCookie).not.toHaveBeenCalled();
  });

  it("returns a redirect target instead of throwing when redirectTo is null", async () => {
    // The client (CompanyNameLink) passes null to opt out of the
    // server-side redirect and do window.location.href instead.
    // A full browser reload is what defeats Next's Router Cache
    // holding stale RSC payloads keyed by URL — the bug where the
    // sidebar showed the new tenant while the destination page
    // still served the old tenant's rows. If this contract breaks
    // and the action goes back to throwing NEXT_REDIRECT, the
    // client would never reach the reload call.
    mocks.requireRole.mockResolvedValue(sysAdminSession());
    const { scopeIntoCompanyAction } = await import("./scope-actions");

    const result = await scopeIntoCompanyAction("co_target", null);

    expect(result).toEqual({ ok: true, redirectTo: "/dashboard" });
    expect(mocks.setScopedCompanyCookie).toHaveBeenCalledWith(
      "co_target",
      "system_admin"
    );
    expect(mocks.redirect).not.toHaveBeenCalled();
    // The layout still gets a server-side revalidation ping so any
    // subsequent server-render (before the client reload lands)
    // sees the fresh cookie.
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("still guards a soft-deleted tenant when redirectTo is null", async () => {
    // The freshness check must run regardless of which return
    // shape the caller asked for — otherwise a client caller
    // could pass null and slip a ghost-tenant scope past the
    // guard.
    mocks.requireRole.mockResolvedValue(sysAdminSession());
    mocks.missingCompanyIds.add("co_ghost");
    const { scopeIntoCompanyAction } = await import("./scope-actions");

    const target = await captureRedirect(() =>
      scopeIntoCompanyAction("co_ghost", null)
    );

    expect(target).toBe("/admin/companies");
    expect(mocks.setScopedCompanyCookie).not.toHaveBeenCalled();
  });
});

// ==============================================================
// exitCompanyScopeAction
// ==============================================================
describe("exitCompanyScopeAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redirect.mockImplementation((url: string) => {
      throw { __redirect: true, url };
    });
  });

  it("clears the cookie and redirects to /admin/companies", async () => {
    mocks.requireRole.mockResolvedValue(sysAdminSession());
    const { exitCompanyScopeAction } = await import("./scope-actions");

    const target = await captureRedirect(() => exitCompanyScopeAction());

    expect(target).toBe("/admin/companies");
    expect(mocks.clearScopedCompanyCookie).toHaveBeenCalledTimes(1);
  });
});
