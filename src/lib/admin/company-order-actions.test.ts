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
  rows: [] as Array<{ id: string; sort_order: number | null; name?: string }>,
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

  it("writes only the two companies swapped, not the rows below a gap", async () => {
    // A removed company left a gap at 3. Swapping the last two must not
    // re-save "d" and "e", whose places did not change.
    mocks.rows = [
      { id: "a", sort_order: 1, name: "a" },
      { id: "b", sort_order: 2, name: "b" },
      { id: "d", sort_order: 4, name: "d" },
      { id: "e", sort_order: 5, name: "e" },
      { id: "x", sort_order: 6, name: "x" },
      { id: "y", sort_order: 7, name: "y" },
    ];
    await reorder(["a", "b", "d", "e", "y", "x"]);
    expect(mocks.updates).toEqual([
      { id: "y", sort_order: 6 },
      { id: "x", sort_order: 7 },
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

// ---- Only the companies whose place changed are written (2026-09-29) --

describe("planCompanyReorder", () => {
  // What the list shows after the writes: positions, then name.
  function listAfter(
    rows: Array<{ id: string; sort_order: number | null; name: string }>,
    writes: Array<{ id: string; position: number }>
  ): string[] {
    const saved = new Map(rows.map((r) => [r.id, r.sort_order]));
    for (const w of writes) saved.set(w.id, w.position);
    return [...rows]
      .sort((a, b) => {
        const x = saved.get(a.id), y = saved.get(b.id);
        if (x === null && y === null) return a.name.localeCompare(b.name);
        if (x === null) return 1;
        if (y === null) return -1;
        return (x as number) - (y as number) || a.name.localeCompare(b.name);
      })
      .map((r) => r.id);
  }
  const named = (ids: string[], positions: Array<number | null>) =>
    ids.map((id, i) => ({ id, sort_order: positions[i], name: id }));

  it("swaps two companies at the end with two writes, even with a gap above them", async () => {
    const { planCompanyReorder } = await import("./company-order-actions");
    // A removed company left a gap at 6.
    const rows = named(["a", "b", "c", "d", "e", "g", "h", "fx1", "fx2"], [1, 2, 3, 4, 5, 7, 8, 23, 24]);
    const writes = planCompanyReorder(rows, ["a", "b", "c", "d", "e", "g", "h", "fx2", "fx1"]);
    expect(writes).toEqual([
      { id: "fx2", position: 23 },
      { id: "fx1", position: 24 },
    ]);
    expect(listAfter(rows, writes)).toEqual(["a", "b", "c", "d", "e", "g", "h", "fx2", "fx1"]);
  });

  it("writes nothing for a company whose place did not change", async () => {
    const { planCompanyReorder } = await import("./company-order-actions");
    const rows = named(["a", "b", "c", "d"], [1, 5, 9, 12]);
    const writes = planCompanyReorder(rows, ["a", "c", "b", "d"]);
    expect(writes.map((w) => w.id).sort()).toEqual(["b", "c"]);
  });

  it("still saves the new order for any drag, gaps or not", async () => {
    const { planCompanyReorder } = await import("./company-order-actions");
    // A fixed-seed shuffle, so a failure reproduces.
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let run = 0; run < 400; run += 1) {
      const n = 2 + Math.floor(rand() * 12);
      const ids = Array.from({ length: n }, (_, i) => `c${i}`);
      let p = 0;
      const positions = ids.map(() => (p += 1 + Math.floor(rand() * 3)));
      const rows = named(ids, positions);
      // One company dragged from one place to another: a real drag.
      const from = Math.floor(rand() * n), to = Math.floor(rand() * n);
      const order = [...ids];
      const [moved] = order.splice(from, 1);
      order.splice(to, 0, moved);
      const writes = planCompanyReorder(rows, order);
      expect(listAfter(rows, writes), `run ${run}`).toEqual(order);
      // And nothing whose place held was written.
      for (const w of writes) expect(order.indexOf(w.id)).not.toBe(ids.indexOf(w.id));
    }
  });

  it("falls back to numbering 1..N when a company has no position yet", async () => {
    const { planCompanyReorder } = await import("./company-order-actions");
    const rows = named(["a", "b", "c"], [1, null, 3]);
    const writes = planCompanyReorder(rows, ["b", "a", "c"]);
    expect(listAfter(rows, writes)).toEqual(["b", "a", "c"]);
  });
});
