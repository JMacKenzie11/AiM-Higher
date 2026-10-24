import { describe, it, expect, beforeEach, vi } from "vitest";

// A guide's own company: the coaching business they run as well as
// guiding clients (Jason, 2026-10-24). setGuideOwnCompanyAction makes
// them a member of it (profiles.company_id) and its admin (a guide
// assignment), and setGuideCompanyAccessAction will not untick it.

const mocks = vi.hoisted(() => {
  const state = {
    profile: { id: "g_1", role: "aims_guide", company_id: null as string | null } as
      | { id: string; role: string; company_id: string | null }
      | null,
    company: { id: "co_own" } as { id: string } | null,
    assignments: [] as string[],
  };
  const calls: string[] = [];
  const profilesUpdate = vi.fn();
  const assignmentsUpsert = vi.fn();
  const assignmentsInsert = vi.fn();

  const from = (table: string) => {
    if (table === "profiles") {
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.profile }) }) }),
        update: (patch: unknown) => {
          calls.push("profile");
          profilesUpdate(patch);
          return { eq: async () => ({ error: null }) };
        },
      };
    }
    if (table === "companies") {
      return {
        select: () => ({ eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: state.company }) }) }) }),
      };
    }
    if (table === "guide_assignments") {
      return {
        select: () => ({
          eq: async () => ({ data: state.assignments.map((company_id) => ({ company_id })) }),
        }),
        upsert: async (row: unknown) => {
          calls.push("assign");
          assignmentsUpsert(row);
          return { error: null };
        },
        insert: async (rows: unknown) => {
          assignmentsInsert(rows);
          return { error: null };
        },
        delete: () => ({ eq: () => ({ in: async () => ({ error: null }) }) }),
      };
    }
    if (table === "commitments") {
      const chain = { update: () => chain, eq: () => chain, is: async () => ({ error: null }) };
      return chain;
    }
    throw new Error(`Unexpected table in test: ${table}`);
  };

  return { state, calls, profilesUpdate, assignmentsUpsert, assignmentsInsert, admin: { from } };
});

vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => mocks.admin }));
vi.mock("@/lib/auth/current-user", () => ({
  requireRole: async () => ({ profile: { id: "root", role: "system_admin" } }),
}));
vi.mock("@/lib/auth/users", () => ({ dispatchInvite: vi.fn() }));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/instances/current", () => ({ getCurrentInstanceConfig: () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.calls.length = 0;
  mocks.state.profile = { id: "g_1", role: "aims_guide", company_id: null };
  mocks.state.company = { id: "co_own" };
  mocks.state.assignments = [];
});

describe("setGuideOwnCompanyAction", () => {
  it("assigns the guide to the company, then makes them a member of it", async () => {
    const { setGuideOwnCompanyAction } = await import("./guides-actions");
    const result = await setGuideOwnCompanyAction("g_1", "co_own");
    expect(result.ok).toBe(true);
    expect(mocks.assignmentsUpsert).toHaveBeenCalledWith({ guide_id: "g_1", company_id: "co_own" });
    expect(mocks.profilesUpdate).toHaveBeenCalledWith({ company_id: "co_own" });
    // Never a member who is not yet its admin.
    expect(mocks.calls).toEqual(["assign", "profile"]);
  });

  it("clears it without touching their assignments", async () => {
    mocks.state.profile = { id: "g_1", role: "aims_guide", company_id: "co_own" };
    const { setGuideOwnCompanyAction } = await import("./guides-actions");
    const result = await setGuideOwnCompanyAction("g_1", null);
    expect(result.ok).toBe(true);
    expect(mocks.profilesUpdate).toHaveBeenCalledWith({ company_id: null });
    expect(mocks.assignmentsUpsert).not.toHaveBeenCalled();
  });

  it("gives a system admin one the same way, and leaves them a system admin", async () => {
    mocks.state.profile = { id: "root_2", role: "system_admin", company_id: null };
    const { setGuideOwnCompanyAction } = await import("./guides-actions");
    const result = await setGuideOwnCompanyAction("root_2", "co_own");
    expect(result.ok).toBe(true);
    expect(mocks.assignmentsUpsert).toHaveBeenCalledWith({ guide_id: "root_2", company_id: "co_own" });
    expect(mocks.profilesUpdate).toHaveBeenCalledWith({ company_id: "co_own" });
  });

  it("refuses anyone who is not a guide or a system admin", async () => {
    mocks.state.profile = { id: "u_1", role: "team_member", company_id: "co_x" };
    const { setGuideOwnCompanyAction } = await import("./guides-actions");
    const result = await setGuideOwnCompanyAction("u_1", "co_own");
    expect(result.ok).toBe(false);
    expect(mocks.profilesUpdate).not.toHaveBeenCalled();
    expect(mocks.assignmentsUpsert).not.toHaveBeenCalled();
  });

  it("refuses a company that is gone", async () => {
    mocks.state.company = null;
    const { setGuideOwnCompanyAction } = await import("./guides-actions");
    const result = await setGuideOwnCompanyAction("g_1", "co_gone");
    expect(result.ok).toBe(false);
    expect(mocks.profilesUpdate).not.toHaveBeenCalled();
  });
});

describe("setGuideCompanyAccessAction and a guide's own company", () => {
  it("will not untick it", async () => {
    mocks.state.profile = { id: "g_1", role: "aims_guide", company_id: "co_own" };
    mocks.state.assignments = ["co_own", "co_client"];
    const { setGuideCompanyAccessAction } = await import("./guides-actions");
    const result = await setGuideCompanyAccessAction("g_1", ["co_client"]);
    expect(result).toEqual({
      ok: false,
      message: "That's the guide's own company. Change their own company first.",
    });
  });

  it("still lets a client come off the list", async () => {
    mocks.state.profile = { id: "g_1", role: "aims_guide", company_id: "co_own" };
    mocks.state.assignments = ["co_own", "co_client"];
    const { setGuideCompanyAccessAction } = await import("./guides-actions");
    const result = await setGuideCompanyAccessAction("g_1", ["co_own"]);
    expect(result.ok).toBe(true);
  });
});

describe("saveGuideAction: one Save for the row", () => {
  it("sets their own company, then keeps it in their companies", async () => {
    mocks.state.assignments = ["co_client"];
    const { saveGuideAction } = await import("./guides-actions");
    const result = await saveGuideAction("g_1", ["co_client"], "co_own");
    expect(result.ok).toBe(true);
    expect(mocks.calls.slice(0, 2)).toEqual(["assign", "profile"]);
    expect(mocks.profilesUpdate).toHaveBeenCalledWith({ company_id: "co_own" });
  });

  it("stops before the companies when their own company can't be set", async () => {
    mocks.state.company = null;
    const { saveGuideAction } = await import("./guides-actions");
    const result = await saveGuideAction("g_1", ["co_client"], "co_gone");
    expect(result.ok).toBe(false);
    expect(mocks.assignmentsInsert).not.toHaveBeenCalled();
  });

  it("leaves their own company alone when the row offers none", async () => {
    mocks.state.profile = { id: "g_1", role: "aims_guide", company_id: "co_own" };
    mocks.state.assignments = ["co_own"];
    const { saveGuideAction } = await import("./guides-actions");
    const result = await saveGuideAction("g_1", ["co_own", "co_client"]);
    expect(result.ok).toBe(true);
    expect(mocks.profilesUpdate).not.toHaveBeenCalled();
    expect(mocks.assignmentsInsert).toHaveBeenCalledWith([{ guide_id: "g_1", company_id: "co_client" }]);
  });
});

