import { describe, it, expect, beforeEach, vi } from "vitest";

// Starting a new planning cycle archives every active SFA, goal and
// priority for a company. Who is allowed to ask is the whole of what
// these pin.
//
// THE BUG. The guard tested only whether a company_admin was in the
// right company. An aims_guide fell through it: requireRole admitted
// them and nothing below asked whose caseload the company was in.
//
// RLS held — the UPDATE policies admit a guide only through
// is_guide_for(), so an unassigned one matched no rows and nothing was
// archived. What came back was `{ ok: true, sfaCount: 0, ... }`: a
// success report for an action that had been refused, identical on
// screen to "there was nothing to reset". Nothing was destroyed; the
// report was the bug.

const mocks = vi.hoisted(() => {
  const archived = vi.fn();
  const commitmentsUpdate = vi.fn();

  const fromBuilder = (table: string) => {
    if (table === "commitments") {
      return {
        update: () => ({
          eq: () => ({ eq: () => ({ in: commitmentsUpdate }) }),
        }),
      };
    }
    // The three plan tables all take the same shape:
    //   .update({archived:true}).eq().eq().select("id")
    return {
      update: () => ({
        eq: () => ({ eq: () => ({ select: () => archived(table) }) }),
      }),
    };
  };

  return {
    archived,
    commitmentsUpdate,
    serverClient: { from: fromBuilder },
    requireRole: vi.fn(),
    revalidatePath: vi.fn(),
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => mocks.serverClient,
}));
vi.mock("@/lib/instances/current", () => ({
  getCurrentInstanceConfig: () => ({}),
}));
vi.mock("@/lib/auth/current-user", () => ({
  requireRole: mocks.requireRole,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

// isAdminForCompany is NOT mocked. It is the thing under test: the
// fix is that this action asks it at all, and a fake would let the
// test pass against a guard that still did not.

const COMPANY = "co_a";
const OTHER = "co_b";

function sessionFor(profile: Record<string, unknown>) {
  mocks.requireRole.mockResolvedValue({ profile });
}

describe("bulkResetPlanAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.archived.mockResolvedValue({ data: [{ id: "x" }], error: null });
    mocks.commitmentsUpdate.mockResolvedValue({ error: null });
  });

  it("refuses an aims_guide the company is not assigned to", async () => {
    // The bug, as a test. This used to return ok:true with zeros.
    sessionFor({
      id: "g_1",
      role: "aims_guide",
      company_id: null,
      guide_company_ids: [OTHER],
    });
    const { bulkResetPlanAction } = await import("./bulk-reset-action");

    const res = await bulkResetPlanAction(COMPANY);

    expect(res).toEqual({ ok: false, message: "Not your company to reset." });
    // And it refused BEFORE writing, rather than relying on RLS to
    // match nothing.
    expect(mocks.archived).not.toHaveBeenCalled();
  });

  it("allows an aims_guide the company IS assigned to", async () => {
    sessionFor({
      id: "g_1",
      role: "aims_guide",
      company_id: null,
      guide_company_ids: [COMPANY, OTHER],
    });
    const { bulkResetPlanAction } = await import("./bulk-reset-action");

    const res = await bulkResetPlanAction(COMPANY);

    expect(res.ok).toBe(true);
    expect(mocks.archived).toHaveBeenCalledTimes(3);
  });

  it("still refuses a company_admin from another company", async () => {
    // The case the old guard did cover. It must keep working.
    sessionFor({ id: "a_1", role: "company_admin", company_id: OTHER });
    const { bulkResetPlanAction } = await import("./bulk-reset-action");

    expect(await bulkResetPlanAction(COMPANY)).toEqual({
      ok: false,
      message: "Not your company to reset.",
    });
  });

  it("allows a company_admin on their own company", async () => {
    sessionFor({ id: "a_1", role: "company_admin", company_id: COMPANY });
    const { bulkResetPlanAction } = await import("./bulk-reset-action");

    expect((await bulkResetPlanAction(COMPANY)).ok).toBe(true);
  });

  it("allows a system_admin anywhere", async () => {
    sessionFor({ id: "s_1", role: "system_admin", company_id: null });
    const { bulkResetPlanAction } = await import("./bulk-reset-action");

    expect((await bulkResetPlanAction(COMPANY)).ok).toBe(true);
  });

  it("refuses a guide with no assignments at all", async () => {
    // Between caseloads. The empty list must not read as "everything".
    sessionFor({
      id: "g_2",
      role: "aims_guide",
      company_id: null,
      guide_company_ids: [],
    });
    const { bulkResetPlanAction } = await import("./bulk-reset-action");

    expect((await bulkResetPlanAction(COMPANY)).ok).toBe(false);
  });

  it("refuses a guide whose assignments are missing from the session", async () => {
    // guide_company_ids is optional on the profile shape. Absent must
    // mean "no assignments", never "unchecked".
    sessionFor({ id: "g_3", role: "aims_guide", company_id: null });
    const { bulkResetPlanAction } = await import("./bulk-reset-action");

    expect((await bulkResetPlanAction(COMPANY)).ok).toBe(false);
  });

  it("reports zeros only when there was nothing to archive", async () => {
    // With the guard in place, zeros can no longer mean "refused".
    mocks.archived.mockResolvedValue({ data: [], error: null });
    sessionFor({ id: "s_1", role: "system_admin", company_id: null });
    const { bulkResetPlanAction } = await import("./bulk-reset-action");

    expect(await bulkResetPlanAction(COMPANY)).toEqual({
      ok: true,
      sfaCount: 0,
      goalCount: 0,
      priorityCount: 0,
    });
  });
});
