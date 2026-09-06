import { describe, it, expect, beforeEach, vi } from "vitest";

// Server-action tests for src/lib/companies/actions.ts. Two contracts
// carry most of the risk: the feature-diff in setCompanyFeaturesAction
// (dropping a feature MUST remove the row so it stops feeding coach
// context, but must NOT touch the underlying data tables — re-enabling
// restores the same data), and the seeded Visionary/Integrator +
// current-quarter defaults on createCompanyAction (removing them would
// leave a new company unable to open the chart or drop actions).

const REDIRECT_SIGNAL = "__redirect__";

// ---- Shared spies + fakes -------------------------------------
const mocks = vi.hoisted(() => {
  const companiesInsertSingle = vi.fn();
  const companiesUpdatePatch = vi.fn();
  const companiesUpdateSingle = vi.fn();
  const companiesSelectMaybeSingle = vi.fn(); // .select("id, status").eq().maybeSingle()

  // deleteCompanyAction uses the admin client for the UPDATE so the
  // restrictive companies_hide_deleted RLS policy doesn't block the
  // implicit RETURNING check. Track admin-client update calls
  // separately so a test can assert the write went via admin (not
  // the authenticated server client).
  const companiesAdminUpdatePatch = vi.fn();
  const companiesAdminUpdateResult = vi.fn();

  const featuresSelectEq = vi.fn(); // .select("feature").eq("company_id", id) — thenable
  const featuresInsert = vi.fn();
  const featuresDeleteIn = vi.fn(); // .delete().eq("company_id", id).in("feature", toRemove)

  const functionsInsertMaybeSingle = vi.fn();
  const functionsInsertPlain = vi.fn();
  // Track function inserts by ordinal (first = Visionary, second = Integrator).
  const functionsInsertPatches: unknown[] = [];

  const quartersInsertPlain = vi.fn();

  const fromBuilder = (table: string) => {
    if (table === "companies") {
      return {
        insert: () => ({
          select: () => ({ single: companiesInsertSingle }),
        }),
        update: (patch: unknown) => {
          companiesUpdatePatch(patch);
          return {
            eq: () => ({
              select: () => ({ single: companiesUpdateSingle }),
            }),
          };
        },
        select: () => ({
          eq: () => ({ maybeSingle: companiesSelectMaybeSingle }),
        }),
      };
    }
    if (table === "company_features") {
      return {
        insert: featuresInsert,
        select: () => ({ eq: () => featuresSelectEq() }),
        delete: () => ({
          eq: () => ({ in: featuresDeleteIn }),
        }),
      };
    }
    if (table === "functions") {
      // Two shapes:
      //   .insert(...).select("id").maybeSingle()  (Visionary)
      //   .insert(...)                              (Integrator)
      return {
        insert: (patch: unknown) => {
          functionsInsertPatches.push(patch);
          return {
            select: () => ({ maybeSingle: functionsInsertMaybeSingle }),
            // A plain-await `.insert(...)` should resolve too. The
            // Integrator seed doesn't chain past insert; test asserts
            // via functionsInsertPatches ordinal.
            then: (onFulfilled: (v: unknown) => unknown) =>
              Promise.resolve(functionsInsertPlain(patch)).then(onFulfilled),
          };
        },
      };
    }
    if (table === "quarters") {
      return {
        insert: quartersInsertPlain,
      };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  };

  const serverClient = { from: fromBuilder };

  // Admin client: separate fake. deleteCompanyAction uses this to
  // bypass RLS for the soft-delete UPDATE. Only companies.update is
  // exercised — no need to model the other tables here.
  const adminClient = {
    from: (table: string) => {
      if (table !== "companies") {
        throw new Error(`admin client only expected companies, got ${table}`);
      }
      return {
        update: (patch: unknown) => {
          companiesAdminUpdatePatch(patch);
          return { eq: () => companiesAdminUpdateResult() };
        },
      };
    },
  };

  const requireRole = vi.fn();
  const setScopedCompanyCookie = vi.fn();
  const redirect = vi.fn((url: string) => {
    throw { [REDIRECT_SIGNAL]: true, url };
  });
  const revalidatePath = vi.fn();
  const calendarQuarterOf = vi.fn();

  return {
    companiesInsertSingle,
    companiesUpdatePatch,
    companiesUpdateSingle,
    companiesSelectMaybeSingle,
    companiesAdminUpdatePatch,
    companiesAdminUpdateResult,
    featuresSelectEq,
    featuresInsert,
    featuresDeleteIn,
    functionsInsertMaybeSingle,
    functionsInsertPlain,
    functionsInsertPatches,
    quartersInsertPlain,
    serverClient,
    adminClient,
    requireRole,
    setScopedCompanyCookie,
    redirect,
    revalidatePath,
    calendarQuarterOf,
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => mocks.serverClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => mocks.adminClient,
}));

vi.mock("@/lib/admin/scope", () => ({
  setScopedCompanyCookie: mocks.setScopedCompanyCookie,
}));

vi.mock("@/lib/auth/current-user", () => ({
  requireRole: mocks.requireRole,
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("@/lib/quarters/service", () => ({
  calendarQuarterOf: mocks.calendarQuarterOf,
}));

// VALID_COMPANY_FEATURES is a Set — mock with a fixed set the tests can rely on.
vi.mock("@/lib/companies/features", () => ({
  VALID_COMPANY_FEATURES: new Set(["strengths", "classroom", "commitments"]),
}));

// ---- Helpers --------------------------------------------------
function formDataFrom(entries: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) {
    if (Array.isArray(v)) {
      for (const item of v) fd.append(k, item);
    } else {
      fd.set(k, v);
    }
  }
  return fd;
}

function sysAdminSession() {
  return { profile: { id: "root", role: "system_admin", company_id: null } };
}

function primeHappyPath() {
  mocks.requireRole.mockResolvedValue(sysAdminSession());
  mocks.companiesInsertSingle.mockResolvedValue({
    data: {
      id: "co_new",
      name: "Acme",
      timezone: "America/Anchorage",
      industry: null,
      status: "active",
    },
    error: null,
  });
  mocks.companiesUpdateSingle.mockResolvedValue({
    data: {
      id: "co_1",
      name: "Acme",
      timezone: "America/Anchorage",
      industry: null,
      status: "active",
    },
    error: null,
  });
  mocks.featuresInsert.mockResolvedValue({ error: null });
  mocks.featuresSelectEq.mockResolvedValue({
    data: [{ feature: "strengths" }, { feature: "commitments" }],
  });
  mocks.featuresDeleteIn.mockResolvedValue({ error: null });
  mocks.functionsInsertMaybeSingle.mockResolvedValue({
    data: { id: "fn_visionary" },
    error: null,
  });
  mocks.functionsInsertPlain.mockResolvedValue({ error: null });
  mocks.quartersInsertPlain.mockResolvedValue({ error: null });
  mocks.calendarQuarterOf.mockReturnValue({
    label: "2026 Q3",
    startDate: "2026-07-01",
    endDate: "2026-09-30",
  });
  mocks.functionsInsertPatches.length = 0;
}

// ==============================================================
// createCompanyAction
// ==============================================================
describe("createCompanyAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("rejects an empty name", async () => {
    const { createCompanyAction } = await import("./actions");

    const res = await createCompanyAction(
      undefined,
      formDataFrom({ name: "", features: ["strengths"] })
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/name/i);
    expect(mocks.companiesInsertSingle).not.toHaveBeenCalled();
  });

  it("rejects an empty (or all-invalid) features set", async () => {
    // Ensures a company can never be created with no entitlements —
    // that would be a paying-nothing customer with data-tables that
    // no page can render.
    const { createCompanyAction } = await import("./actions");

    const res = await createCompanyAction(
      undefined,
      formDataFrom({ name: "Acme", features: ["nonexistent-feature"] })
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/at least one feature/);
  });

  it("filters out invalid feature names silently while keeping valid ones", async () => {
    const { createCompanyAction } = await import("./actions");

    await createCompanyAction(
      undefined,
      formDataFrom({
        name: "Acme",
        features: ["strengths", "bogus", "classroom", ""],
      })
    );

    const rows = mocks.featuresInsert.mock.calls[0][0] as Array<{
      feature: string;
    }>;
    expect(rows.map((r) => r.feature).sort()).toEqual(["classroom", "strengths"]);
  });

  it("seeds the Visionary + Integrator functions and the current calendar quarter", async () => {
    // Removing these seeds would leave a new company unable to drop
    // actions or open the chart until the admin manually created the
    // root functions and opened a quarter.
    const { createCompanyAction } = await import("./actions");

    await createCompanyAction(
      undefined,
      formDataFrom({ name: "Acme", features: ["strengths"] })
    );

    expect(mocks.functionsInsertPatches).toHaveLength(2);
    const [visionary, integrator] = mocks.functionsInsertPatches as Array<{
      title: string;
      parent_function_id: string | null;
    }>;
    expect(visionary.title).toBe("Visionary");
    expect(visionary.parent_function_id).toBeNull();
    expect(integrator.title).toBe("Integrator");
    expect(integrator.parent_function_id).toBe("fn_visionary");
    // Quarter seed.
    expect(mocks.quartersInsertPlain).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "2026 Q3",
        start_date: "2026-07-01",
        end_date: "2026-09-30",
        status: "open",
      })
    );
  });

  it("returns a partial-success message when the company row saved but features didn't", async () => {
    // The company exists but has no entitlement rows — the admin needs
    // to reopen the detail page and fix it. Better than swallowing and
    // showing "success" for a broken row.
    mocks.featuresInsert.mockResolvedValueOnce({
      error: { message: "permission denied for table company_features" },
    });
    const { createCompanyAction } = await import("./actions");

    const res = await createCompanyAction(
      undefined,
      formDataFrom({ name: "Acme", features: ["strengths"] })
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/features didn't save/);
  });

  it("scopes the creator into the new company before redirecting to it", async () => {
    // Without this the redirect below lands on /hq, not the company.
    // The creator is a system_admin whose scope cookie points at some
    // other company or at nothing, because this one did not exist a
    // moment ago, and middleware sends a cross-tenant role asking for
    // a company they are not scoped into back to the picker.
    const { createCompanyAction } = await import("./actions");

    try {
      await createCompanyAction(
        undefined,
        formDataFrom({
          name: "Acme",
          features: ["strengths"],
          redirect_after: "detail",
        })
      );
    } catch {
      // the redirect throw; the assertion is the cookie write
    }

    expect(mocks.setScopedCompanyCookie).toHaveBeenCalledWith(
      "co_new",
      "system_admin"
    );
  });

  it("does NOT scope the creator in when staying on the list", async () => {
    // The default path returns to /admin/companies. Nothing was
    // entered, so nothing should move the operator's scope — that is
    // the whole rule this change exists to hold.
    const { createCompanyAction } = await import("./actions");

    const res = await createCompanyAction(
      undefined,
      formDataFrom({ name: "Acme", features: ["strengths"] })
    );

    expect(res.ok).toBe(true);
    expect(mocks.setScopedCompanyCookie).not.toHaveBeenCalled();
  });

  it("redirects to the detail page when redirect_after=detail", async () => {
    const { createCompanyAction } = await import("./actions");

    try {
      await createCompanyAction(
        undefined,
        formDataFrom({
          name: "Acme",
          features: ["strengths"],
          redirect_after: "detail",
        })
      );
      throw new Error("Expected a redirect");
    } catch (err) {
      if (err && typeof err === "object" && REDIRECT_SIGNAL in err) {
        expect((err as unknown as { url: string }).url).toBe(
          "/admin/companies/co_new"
        );
      } else {
        throw err;
      }
    }
  });
});

// ==============================================================
// setCompanyFeaturesAction
// ==============================================================
describe("setCompanyFeaturesAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("rejects an empty (or all-invalid) features set", async () => {
    const { setCompanyFeaturesAction } = await import("./actions");

    const res = await setCompanyFeaturesAction("co_1", ["bogus"]);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/at least one feature/);
    expect(mocks.featuresInsert).not.toHaveBeenCalled();
    expect(mocks.featuresDeleteIn).not.toHaveBeenCalled();
  });

  it("computes the diff — adds new features, removes gone features, leaves shared ones alone", async () => {
    // Existing (per primeHappyPath): ["strengths", "commitments"]
    // Desired:                        ["strengths", "classroom"]
    // Add: classroom. Remove: commitments. Leave: strengths.
    const { setCompanyFeaturesAction } = await import("./actions");

    const res = await setCompanyFeaturesAction("co_1", [
      "strengths",
      "classroom",
    ]);

    expect(res).toEqual({ ok: true });
    const inserted = mocks.featuresInsert.mock.calls[0][0] as Array<{
      feature: string;
    }>;
    expect(inserted.map((r) => r.feature)).toEqual(["classroom"]);
    expect(mocks.featuresDeleteIn).toHaveBeenCalledWith("feature", [
      "commitments",
    ]);
  });

  it("makes no writes when the desired set matches the existing set", async () => {
    mocks.featuresSelectEq.mockResolvedValueOnce({
      data: [{ feature: "strengths" }, { feature: "classroom" }],
    });
    const { setCompanyFeaturesAction } = await import("./actions");

    const res = await setCompanyFeaturesAction("co_1", [
      "classroom",
      "strengths",
    ]);

    expect(res).toEqual({ ok: true });
    expect(mocks.featuresInsert).not.toHaveBeenCalled();
    expect(mocks.featuresDeleteIn).not.toHaveBeenCalled();
  });
});

// ==============================================================
// setCompanyIndustryAction
// ==============================================================
describe("setCompanyIndustryAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("blocks a company_admin from another company", async () => {
    mocks.requireRole.mockResolvedValue({
      profile: {
        id: "admin_1",
        role: "company_admin",
        company_id: "co_other",
      },
    });
    const { setCompanyIndustryAction } = await import("./actions");

    const res = await setCompanyIndustryAction("co_target", "Construction");

    expect(res).toEqual({ ok: false, message: "Not your company to edit." });
    expect(mocks.companiesUpdatePatch).not.toHaveBeenCalled();
  });

  it("normalises empty or whitespace-only strings to null", async () => {
    mocks.requireRole.mockResolvedValue(sysAdminSession());
    const { setCompanyIndustryAction } = await import("./actions");

    await setCompanyIndustryAction("co_1", "   ");

    expect(mocks.companiesUpdatePatch).toHaveBeenCalledWith({ industry: null });
  });

  it("trims a submitted industry string", async () => {
    mocks.requireRole.mockResolvedValue(sysAdminSession());
    const { setCompanyIndustryAction } = await import("./actions");

    await setCompanyIndustryAction("co_1", "  Construction  ");

    expect(mocks.companiesUpdatePatch).toHaveBeenCalledWith({
      industry: "Construction",
    });
  });
});

// ==============================================================
// setCompanyStatusAction
// ==============================================================
describe("setCompanyStatusAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("writes the archived status", async () => {
    const { setCompanyStatusAction } = await import("./actions");

    const res = await setCompanyStatusAction("co_1", "archived");

    expect(res.ok).toBe(true);
    expect(mocks.companiesUpdatePatch).toHaveBeenCalledWith({
      status: "archived",
    });
  });
});

// ==============================================================
// deleteCompanyAction
// ==============================================================
// Soft-deletes an archived company by stamping deleted_at on the row.
// The two-step (archive first, then delete) is the safety on
// accidental active-tenant destruction, and the write must go via
// the admin client so the restrictive companies_hide_deleted RLS
// policy doesn't reject the update's implicit RETURNING check.
describe("deleteCompanyAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
    // Default: company exists and is currently archived.
    mocks.companiesSelectMaybeSingle.mockResolvedValue({
      data: { id: "co_archived", status: "archived" },
    });
    mocks.companiesAdminUpdateResult.mockResolvedValue({ error: null });
  });

  it("returns not-found when the company row doesn't exist", async () => {
    mocks.companiesSelectMaybeSingle.mockResolvedValueOnce({ data: null });
    const { deleteCompanyAction } = await import("./actions");

    const res = await deleteCompanyAction("co_missing");

    expect(res).toEqual({ ok: false, message: "Company not found." });
    expect(mocks.companiesAdminUpdatePatch).not.toHaveBeenCalled();
  });

  it("refuses to delete an active company (two-step archive-first safety)", async () => {
    // Prevents an admin from wiping an active tenant with a single
    // click. They must archive it first — the archive step is the
    // pause point where "are you sure?" happens.
    mocks.companiesSelectMaybeSingle.mockResolvedValueOnce({
      data: { id: "co_live", status: "active" },
    });
    const { deleteCompanyAction } = await import("./actions");

    const res = await deleteCompanyAction("co_live");

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/archive the company first/i);
    expect(mocks.companiesAdminUpdatePatch).not.toHaveBeenCalled();
  });

  it("stamps deleted_at via the admin client (not the authenticated client)", async () => {
    // Load-bearing: the write MUST go through the admin client. The
    // restrictive companies_hide_deleted RLS policy is FOR SELECT, but
    // Postgres applies SELECT policies to the new row on UPDATE via
    // the implicit RETURNING check; setting deleted_at IS NOT NULL
    // trips that check with the authenticated client. Admin bypasses
    // RLS, so this test regressess if someone reverts to the server
    // client.
    const { deleteCompanyAction } = await import("./actions");

    const res = await deleteCompanyAction("co_archived");

    expect(res).toEqual({ ok: true });
    expect(mocks.companiesAdminUpdatePatch).toHaveBeenCalledTimes(1);
    const patch = mocks.companiesAdminUpdatePatch.mock.calls[0][0] as {
      deleted_at: string;
    };
    expect(patch.deleted_at).toEqual(expect.any(String));
    // Sanity: a valid ISO 8601 timestamp.
    expect(Number.isNaN(Date.parse(patch.deleted_at))).toBe(false);
    // Also confirm the (still-mocked) authenticated update WASN'T
    // touched — a regression here would mean silent RLS failures for
    // real callers.
    expect(mocks.companiesUpdatePatch).not.toHaveBeenCalled();
  });

  it("surfaces the Supabase error when the admin update fails", async () => {
    mocks.companiesAdminUpdateResult.mockResolvedValueOnce({
      error: { message: "unexpected", code: "42P01" },
    });
    const { deleteCompanyAction } = await import("./actions");

    const res = await deleteCompanyAction("co_archived");

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/couldn't delete/i);
  });

  it("revalidates the admin list + detail page on success", async () => {
    const { deleteCompanyAction } = await import("./actions");

    await deleteCompanyAction("co_archived");

    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/companies");
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/admin/companies/co_archived"
    );
  });
});
