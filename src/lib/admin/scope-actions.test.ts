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
// scopeIntoCompany
// ==============================================================
//
// This is now the ONLY thing that writes the scope cookie. Middleware
// used to do it as a side effect of GET /admin/companies/<id>, which
// meant a Link prefetch could move the operator. So these tests carry
// more weight than they did: every authorization rule for scope-in
// lives here and nowhere else.
//
// The action returns a destination rather than redirecting. The caller
// hard-navigates with window.location, which is what defeats Next's
// Router Cache holding stale RSC payloads keyed by URL — the bug where
// the sidebar showed the new tenant while the destination page still
// served the old tenant's rows.
describe("scopeIntoCompany", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.missingCompanyIds.clear();
    mocks.redirect.mockImplementation((url: string) => {
      throw { __redirect: true, url };
    });
  });

  it("scopes a system_admin into any company, defaulting to the dashboard", async () => {
    mocks.requireRole.mockResolvedValue(sysAdminSession());
    const { scopeIntoCompany } = await import("./scope-actions");

    expect(await scopeIntoCompany("co_target")).toEqual({
      ok: true,
      redirectTo: "/dashboard",
    });
    expect(mocks.setScopedCompanyCookie).toHaveBeenCalledWith(
      "co_target",
      "system_admin"
    );
    // The layout gets a revalidation ping so any server render before
    // the client reload lands sees the fresh cookie.
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("respects an explicit destination", async () => {
    // The companies index passes the settings page, so "Settings"
    // still lands where it says while scoping in on the way.
    mocks.requireRole.mockResolvedValue(sysAdminSession());
    const { scopeIntoCompany } = await import("./scope-actions");

    expect(await scopeIntoCompany("co_target", "/admin/companies/co_target"))
      .toEqual({ ok: true, redirectTo: "/admin/companies/co_target" });
  });

  it("never redirects — the caller navigates", async () => {
    // If this went back to throwing NEXT_REDIRECT the client would
    // never reach its window.location call and the Router Cache bug
    // would return.
    mocks.requireRole.mockResolvedValue(sysAdminSession());
    const { scopeIntoCompany } = await import("./scope-actions");

    await scopeIntoCompany("co_target");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("allows an aims_guide into a company they're assigned to", async () => {
    mocks.requireRole.mockResolvedValue(
      guideSession(["co_acme", "co_meridian"])
    );
    const { scopeIntoCompany } = await import("./scope-actions");

    expect(await scopeIntoCompany("co_meridian")).toEqual({
      ok: true,
      redirectTo: "/dashboard",
    });
    expect(mocks.setScopedCompanyCookie).toHaveBeenCalledWith(
      "co_meridian",
      "aims_guide"
    );
  });

  it("refuses an aims_guide who isn't assigned to the target — no cookie is set", async () => {
    // The security-critical path. A guide MUST NOT be able to scope
    // into a company that isn't on their assignment list, and the
    // refusal has to happen before setScopedCompanyCookie.
    mocks.requireRole.mockResolvedValue(guideSession(["co_acme"]));
    const { scopeIntoCompany } = await import("./scope-actions");

    const result = await scopeIntoCompany("co_forbidden");

    expect(result.ok).toBe(false);
    expect(mocks.setScopedCompanyCookie).not.toHaveBeenCalled();
  });

  it("refuses an aims_guide with an empty assignments list", async () => {
    // Guide row exists but the join table returned nothing.
    mocks.requireRole.mockResolvedValue(guideSession([]));
    const { scopeIntoCompany } = await import("./scope-actions");

    const result = await scopeIntoCompany("co_target");

    expect(result.ok).toBe(false);
    expect(mocks.setScopedCompanyCookie).not.toHaveBeenCalled();
  });

  it("refuses a soft-deleted tenant", async () => {
    // Prevents the "scoped into a ghost tenant" bug that stranded
    // chats on since-deleted companies. RLS hides the row, the
    // freshness probe sees null, no cookie is written.
    mocks.requireRole.mockResolvedValue(sysAdminSession());
    mocks.missingCompanyIds.add("co_ghost");
    const { scopeIntoCompany } = await import("./scope-actions");

    const result = await scopeIntoCompany("co_ghost");

    expect(result.ok).toBe(false);
    expect(mocks.setScopedCompanyCookie).not.toHaveBeenCalled();
  });

  it("runs the freshness check whatever destination was asked for", async () => {
    // Otherwise a caller could slip a ghost-tenant scope past the
    // guard by naming a different destination.
    mocks.requireRole.mockResolvedValue(sysAdminSession());
    mocks.missingCompanyIds.add("co_ghost");
    const { scopeIntoCompany } = await import("./scope-actions");

    const result = await scopeIntoCompany("co_ghost", "/plan");

    expect(result.ok).toBe(false);
    expect(mocks.setScopedCompanyCookie).not.toHaveBeenCalled();
  });

  it("gates on role before anything else", async () => {
    // requireRole is the first line: only the two cross-tenant roles
    // reach the rest of the action at all.
    mocks.requireRole.mockResolvedValue(sysAdminSession());
    const { scopeIntoCompany } = await import("./scope-actions");
    await scopeIntoCompany("co_target");

    expect(mocks.requireRole).toHaveBeenCalledWith([
      "system_admin",
      "aims_guide",
    ]);
  });
});
