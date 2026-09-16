import { describe, it, expect, beforeEach, vi } from "vitest";

// The app-layer guard on ending a guide's engagement. Spec §1a,
// decisions 7 and 5.
//
// RLS IS THE BOUNDARY HERE, not this check. guide_assignments_delete
// (0201) is what actually decides, and the harness case
// guide-assignment-revocation asserts it as four claims against the
// clone, shown failing first. These tests cover the courtesy half:
// turning a refusal that would remove zero rows and report nothing
// into a message somebody can read.

const mocks = vi.hoisted(() => ({
  profile: {
    id: "ca_1",
    role: "company_admin" as string,
    company_id: "co_a" as string | null,
    guide_company_ids: [] as string[],
    portfolio_company_ids: [] as string[],
  },
  del: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/current-user", () => ({
  requireProfile: async () => ({ profile: mocks.profile }),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

vi.mock("@/lib/instances/current", () => ({
  getCurrentInstanceConfig: () => ({}),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: () => ({
      delete: () => ({
        eq: () => ({ eq: mocks.del }),
      }),
    }),
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.profile.id = "ca_1";
  mocks.profile.role = "company_admin";
  mocks.profile.company_id = "co_a";
  mocks.profile.guide_company_ids = [];
  mocks.profile.portfolio_company_ids = [];
  mocks.del.mockResolvedValue({ error: null, count: 1 });
});

describe("removeGuideFromCompanyAction", () => {
  it("lets a company admin end an assignment in their own company", async () => {
    const { removeGuideFromCompanyAction } = await import(
      "./assigned-access-actions"
    );
    const result = await removeGuideFromCompanyAction("co_a", "g_1");
    expect(result.ok).toBe(true);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/companies/co_a");
  });

  it("refuses a company admin another company", async () => {
    const { removeGuideFromCompanyAction } = await import(
      "./assigned-access-actions"
    );
    const result = await removeGuideFromCompanyAction("co_b", "g_1");
    expect(result.ok).toBe(false);
    // Refused before the query, not by it. RLS would refuse too, but
    // a delete it refuses removes zero rows and raises nothing, so
    // reaching the database here would produce "already gone" for
    // something that is not gone.
    expect(mocks.del).not.toHaveBeenCalled();
  });

  it("refuses an ordinary team member of the same company", async () => {
    mocks.profile.role = "team_member";
    const { removeGuideFromCompanyAction } = await import(
      "./assigned-access-actions"
    );
    const result = await removeGuideFromCompanyAction("co_a", "g_1");
    expect(result.ok).toBe(false);
    expect(mocks.del).not.toHaveBeenCalled();
  });

  it("lets an assigned portfolio admin end one", async () => {
    // They hold company-admin-equivalent rights in companies they are
    // assigned to (decision 1), and isAdminForCompany is where that
    // arrives. is_admin_for() says the same thing in the database.
    mocks.profile.role = "portfolio_admin";
    mocks.profile.company_id = null;
    mocks.profile.portfolio_company_ids = ["co_a"];
    const { removeGuideFromCompanyAction } = await import(
      "./assigned-access-actions"
    );
    expect((await removeGuideFromCompanyAction("co_a", "g_1")).ok).toBe(true);
  });

  it("refuses an UNASSIGNED portfolio admin", async () => {
    mocks.profile.role = "portfolio_admin";
    mocks.profile.company_id = null;
    mocks.profile.portfolio_company_ids = [];
    const { removeGuideFromCompanyAction } = await import(
      "./assigned-access-actions"
    );
    const result = await removeGuideFromCompanyAction("co_a", "g_1");
    expect(result.ok).toBe(false);
    expect(mocks.del).not.toHaveBeenCalled();
  });

  it("reports zero rows as a failure rather than a success", async () => {
    // THE ONE THAT MATTERS MOST. An RLS refusal deletes zero rows and
    // raises nothing, so a count of 0 read as success would leave the
    // guide on the page after a control that said it removed them.
    // Failure mode E11's symptom, and the same shape as the
    // bulkResetPlanAction bug: the SUCCESS REPORT was the defect.
    mocks.del.mockResolvedValue({ error: null, count: 0 });
    const { removeGuideFromCompanyAction } = await import(
      "./assigned-access-actions"
    );
    const result = await removeGuideFromCompanyAction("co_a", "g_1");
    expect(result.ok).toBe(false);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("reports a database error rather than claiming success", async () => {
    mocks.del.mockResolvedValue({ error: { message: "boom" }, count: null });
    const { removeGuideFromCompanyAction } = await import(
      "./assigned-access-actions"
    );
    expect((await removeGuideFromCompanyAction("co_a", "g_1")).ok).toBe(false);
  });
});

describe("removePortfolioAssignmentAction", () => {
  it("lets a company admin end an assignment to their own company", async () => {
    const { removePortfolioAssignmentAction } = await import(
      "./assigned-access-actions"
    );
    const result = await removePortfolioAssignmentAction("co_a", "pa_1");
    expect(result.ok).toBe(true);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/people");
  });

  it("refuses another company's admin", async () => {
    const { removePortfolioAssignmentAction } = await import(
      "./assigned-access-actions"
    );
    const result = await removePortfolioAssignmentAction("co_b", "pa_1");
    expect(result.ok).toBe(false);
    expect(mocks.del).not.toHaveBeenCalled();
  });

  it("refuses a team member of the same company", async () => {
    mocks.profile.role = "team_member";
    const { removePortfolioAssignmentAction } = await import(
      "./assigned-access-actions"
    );
    expect((await removePortfolioAssignmentAction("co_a", "pa_1")).ok).toBe(
      false
    );
    expect(mocks.del).not.toHaveBeenCalled();
  });

  it("reports zero rows as a failure rather than a success", async () => {
    // An RLS refusal deletes nothing and raises nothing. Reporting
    // success would leave them on the roster after a control that
    // said it removed them.
    mocks.del.mockResolvedValue({ error: null, count: 0 });
    const { removePortfolioAssignmentAction } = await import(
      "./assigned-access-actions"
    );
    const result = await removePortfolioAssignmentAction("co_a", "pa_1");
    expect(result.ok).toBe(false);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
