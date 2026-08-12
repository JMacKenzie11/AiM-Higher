import { describe, it, expect, beforeEach, vi } from "vitest";

// Server-action tests for src/lib/role-descriptions/actions.ts.
// Only one action lives here — suggestForFunctionAction — but its
// permission gate is subtle: any admin for the function's OWN company
// can call it (system_admin, matching company_admin, or an aims_guide
// with the function's company in their assignments). Cross-company
// callers must be rejected before the recommendation engine runs.

// ---- Shared spies + fakes -------------------------------------
const mocks = vi.hoisted(() => {
  const functionsSelectMaybeSingle = vi.fn();
  const outcomesSelectMaybeSingle = vi.fn();

  const fromBuilder = (table: string) => {
    if (table === "functions") {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: functionsSelectMaybeSingle }),
        }),
      };
    }
    if (table === "function_outcomes") {
      // Two chained eq()s (id, function_id) before maybeSingle.
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: outcomesSelectMaybeSingle }),
          }),
        }),
      };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  };

  const serverClient = { from: fromBuilder };
  const requireProfile = vi.fn();
  const recommendForFunction = vi.fn();

  return {
    functionsSelectMaybeSingle,
    outcomesSelectMaybeSingle,
    serverClient,
    requireProfile,
    recommendForFunction,
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => mocks.serverClient,
}));

vi.mock("@/lib/auth/current-user", () => ({
  requireProfile: mocks.requireProfile,
}));

vi.mock("./recommend", () => ({
  recommendForFunction: mocks.recommendForFunction,
}));

// isAdminForCompany is pure — no need to mock. We build sessions that
// exercise each of its branches via the real implementation.

// ---- Helpers --------------------------------------------------
function sessionFor(profile: {
  id?: string;
  role?: "system_admin" | "company_admin" | "team_member" | "aims_guide";
  company_id?: string | null;
  guide_company_ids?: string[];
}) {
  return {
    profile: {
      id: profile.id ?? "caller_1",
      role: profile.role ?? "team_member",
      company_id:
        "company_id" in profile ? profile.company_id : "co_acme",
      guide_company_ids: profile.guide_company_ids ?? [],
    },
  };
}

function primeHappyPath() {
  mocks.functionsSelectMaybeSingle.mockResolvedValue({
    data: { company_id: "co_acme" },
    error: null,
  });
  mocks.outcomesSelectMaybeSingle.mockResolvedValue({
    data: {
      title: "On-time delivery",
      description: "Deliver every project on the committed date.",
    },
    error: null,
  });
  mocks.recommendForFunction.mockResolvedValue([
    { kind: "outcome", title: "Ship on time" },
  ]);
}

// ==============================================================
// suggestForFunctionAction
// ==============================================================
describe("suggestForFunctionAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("errors when the function doesn't exist", async () => {
    mocks.requireProfile.mockResolvedValue(
      sessionFor({ role: "system_admin" })
    );
    mocks.functionsSelectMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });
    const { suggestForFunctionAction } = await import("./actions");

    const res = await suggestForFunctionAction({
      functionId: "fn_missing",
      target: "outcomes",
    });

    expect(res).toEqual({ ok: false, message: "Function not found." });
    expect(mocks.recommendForFunction).not.toHaveBeenCalled();
  });

  it("blocks a team_member (not an admin for any company)", async () => {
    mocks.requireProfile.mockResolvedValue(
      sessionFor({ role: "team_member", company_id: "co_acme" })
    );
    const { suggestForFunctionAction } = await import("./actions");

    const res = await suggestForFunctionAction({
      functionId: "fn_1",
      target: "outcomes",
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/permission/);
    expect(mocks.recommendForFunction).not.toHaveBeenCalled();
  });

  it("blocks a company_admin whose company doesn't own this function", async () => {
    mocks.requireProfile.mockResolvedValue(
      sessionFor({ role: "company_admin", company_id: "co_other" })
    );
    const { suggestForFunctionAction } = await import("./actions");

    const res = await suggestForFunctionAction({
      functionId: "fn_1",
      target: "outcomes",
    });

    expect(res.ok).toBe(false);
    expect(mocks.recommendForFunction).not.toHaveBeenCalled();
  });

  it("blocks an aims_guide who isn't assigned to the function's company", async () => {
    mocks.requireProfile.mockResolvedValue(
      sessionFor({
        role: "aims_guide",
        company_id: null,
        guide_company_ids: ["co_other"],
      })
    );
    const { suggestForFunctionAction } = await import("./actions");

    const res = await suggestForFunctionAction({
      functionId: "fn_1",
      target: "outcomes",
    });

    expect(res.ok).toBe(false);
    expect(mocks.recommendForFunction).not.toHaveBeenCalled();
  });

  it("allows an aims_guide with the function's company in their assignments", async () => {
    mocks.requireProfile.mockResolvedValue(
      sessionFor({
        role: "aims_guide",
        company_id: null,
        guide_company_ids: ["co_acme", "co_meridian"],
      })
    );
    const { suggestForFunctionAction } = await import("./actions");

    const res = await suggestForFunctionAction({
      functionId: "fn_1",
      target: "outcomes",
    });

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.recommendations).toHaveLength(1);
  });

  it("rejects target='measures' without an outcomeId", async () => {
    mocks.requireProfile.mockResolvedValue(
      sessionFor({ role: "system_admin" })
    );
    const { suggestForFunctionAction } = await import("./actions");

    const res = await suggestForFunctionAction({
      functionId: "fn_1",
      target: "measures",
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/which outcome/);
    expect(mocks.recommendForFunction).not.toHaveBeenCalled();
  });

  it("rejects an outcomeId that doesn't belong to the given function", async () => {
    // Guard against a client crafting a request where outcomeId comes
    // from a different function's row. The double-eq (id + function_id)
    // in the query enforces this; we pin the error message here.
    mocks.requireProfile.mockResolvedValue(
      sessionFor({ role: "system_admin" })
    );
    mocks.outcomesSelectMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });
    const { suggestForFunctionAction } = await import("./actions");

    const res = await suggestForFunctionAction({
      functionId: "fn_1",
      target: "measures",
      outcomeId: "outcome_from_another_function",
    });

    expect(res).toEqual({
      ok: false,
      message: "That outcome doesn't belong to this function.",
    });
    expect(mocks.recommendForFunction).not.toHaveBeenCalled();
  });

  it("feeds outcome title + description into the recommendation engine for target=measures", async () => {
    mocks.requireProfile.mockResolvedValue(
      sessionFor({ role: "system_admin" })
    );
    const { suggestForFunctionAction } = await import("./actions");

    const res = await suggestForFunctionAction({
      functionId: "fn_1",
      target: "measures",
      outcomeId: "outcome_1",
    });

    expect(res.ok).toBe(true);
    expect(mocks.recommendForFunction).toHaveBeenCalledWith({
      functionId: "fn_1",
      target: "measures",
      outcomeTitle: "On-time delivery",
      outcomeDescription: "Deliver every project on the committed date.",
    });
  });
});
