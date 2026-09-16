import { describe, it, expect, beforeEach, vi } from "vitest";

// Ordering the portfolio. Migration 0203.
//
// RLS AND THE COLUMN GUARD ARE THE BOUNDARY, not this check. The
// harness case company-sort-order asserts it as five claims against
// the clone, including the two that matter most: a company_admin and
// a guide are refused sort_order by a denylist written before the
// column existed. These tests cover the app half — the role gate, and
// the diff that decides how many writes a drop costs.

const mocks = vi.hoisted(() => ({
  profile: { id: "u_1", role: "system_admin" as string, company_id: null as string | null },
  rows: [] as Array<{ id: string; sort_order: number | null }>,
  updates: [] as Array<{ id: string; sort_order: number }>,
  updateError: null as { message: string } | null,
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
      select: () => ({ in: async () => ({ data: mocks.rows }) }),
      update: (patch: { sort_order: number }) => ({
        eq: async (_col: string, id: string) => {
          mocks.updates.push({ id, sort_order: patch.sort_order });
          return { error: mocks.updateError };
        },
      }),
    }),
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.profile = { id: "u_1", role: "system_admin", company_id: null };
  mocks.rows = [];
  mocks.updates = [];
  mocks.updateError = null;
});

async function reorder(ids: string[]) {
  const { reorderCompaniesAction } = await import("./company-order-actions");
  return reorderCompaniesAction(ids);
}

describe("reorderCompaniesAction", () => {
  it("writes 1..N positions in the order given", async () => {
    mocks.rows = [
      { id: "a", sort_order: null },
      { id: "b", sort_order: null },
      { id: "c", sort_order: null },
    ];
    expect((await reorder(["c", "a", "b"])).ok).toBe(true);
    expect(mocks.updates).toEqual([
      { id: "c", sort_order: 1 },
      { id: "a", sort_order: 2 },
      { id: "b", sort_order: 3 },
    ]);
  });

  it("writes only the rows that actually moved", async () => {
    // A drag shifts a contiguous handful, so a twelve-company
    // instance should not cost twelve round trips. Here only the
    // last two swap.
    mocks.rows = [
      { id: "a", sort_order: 1 },
      { id: "b", sort_order: 2 },
      { id: "c", sort_order: 3 },
    ];
    await reorder(["a", "c", "b"]);
    expect(mocks.updates).toEqual([
      { id: "c", sort_order: 2 },
      { id: "b", sort_order: 3 },
    ]);
  });

  it("writes nothing when the order is unchanged", async () => {
    mocks.rows = [
      { id: "a", sort_order: 1 },
      { id: "b", sort_order: 2 },
    ];
    expect((await reorder(["a", "b"])).ok).toBe(true);
    expect(mocks.updates).toEqual([]);
  });

  it("lets a portfolio_admin reorder", async () => {
    mocks.profile = { id: "pa_1", role: "portfolio_admin", company_id: null };
    mocks.rows = [{ id: "a", sort_order: null }];
    expect((await reorder(["a"])).ok).toBe(true);
  });

  it("refuses a company_admin before touching the database", async () => {
    // The column guard refuses them too, and that is the boundary.
    // This stops the page offering a gesture that would fail.
    mocks.profile = { id: "ca_1", role: "company_admin", company_id: "co_a" };
    mocks.rows = [{ id: "a", sort_order: null }];
    const result = await reorder(["a", "b"]);
    expect(result.ok).toBe(false);
    expect(mocks.updates).toEqual([]);
  });

  it("refuses a guide", async () => {
    mocks.profile = { id: "g_1", role: "aims_guide", company_id: null };
    const result = await reorder(["a", "b"]);
    expect(result.ok).toBe(false);
    expect(mocks.updates).toEqual([]);
  });

  it("refuses a team member", async () => {
    mocks.profile = { id: "tm_1", role: "team_member", company_id: "co_a" };
    expect((await reorder(["a", "b"])).ok).toBe(false);
  });

  it("reports a failed write rather than claiming the order was saved", async () => {
    mocks.rows = [{ id: "a", sort_order: null }];
    mocks.updateError = { message: "nope" };
    const result = await reorder(["a"]);
    expect(result.ok).toBe(false);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("does nothing at all for an empty list", async () => {
    expect((await reorder([])).ok).toBe(true);
    expect(mocks.updates).toEqual([]);
  });
});
