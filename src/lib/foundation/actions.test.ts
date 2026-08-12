import { describe, it, expect, beforeEach, vi } from "vitest";

// Server-action tests for src/lib/foundation/actions.ts. Most of this
// module is straightforward CRUD; the interesting behaviors that
// need pinning are the sort_order auto-append (new items land at the
// bottom of the kind-scoped list), validateItemKind's whitelist (a
// garbage kind must NEVER reach the DB), and parseLanguageBank's
// blank-line stripping.

// ---- Shared spies + fakes -------------------------------------
const mocks = vi.hoisted(() => {
  const foundationUpsert = vi.fn();
  const foundationUpsertSingle = vi.fn();

  const itemsInsertPatch = vi.fn();
  const itemsInsertSingle = vi.fn();
  const itemsSelectMaybeSingle = vi.fn();
  const itemsSelectListSort = vi.fn(); // .select("sort_order").eq().eq().order().limit(1)
  const itemsSelectNeighbour = vi.fn(); // .select("*").eq().eq().[lt|gt]().order().limit(1)
  const itemsUpdatePatch = vi.fn();
  const itemsUpdateEq = vi.fn();
  const itemsDeleteEq = vi.fn();

  const pillarsInsertPatch = vi.fn();
  const pillarsInsertSingle = vi.fn();
  const pillarsSelectSort = vi.fn(); // .select("sort_order").eq().order().limit(1)

  const snippetsInsertPatch = vi.fn();

  const fromBuilder = (table: string) => {
    if (table === "company_foundation") {
      return {
        upsert: (patch: unknown, opts: unknown) => {
          foundationUpsert(patch, opts);
          return { select: () => ({ single: foundationUpsertSingle }) };
        },
      };
    }
    if (table === "foundation_items") {
      return {
        insert: (patch: unknown) => {
          itemsInsertPatch(patch);
          return { select: () => ({ single: itemsInsertSingle }) };
        },
        select: () => ({
          eq: () => ({
            // Two shapes reach here:
            //  a) .eq().eq().order().limit()   — sort_order tail lookup
            //  b) .eq().eq().[lt|gt]().order().limit()  — neighbour lookup
            eq: () => ({
              order: () => ({ limit: () => itemsSelectListSort() }),
              lt: () => ({ order: () => ({ limit: () => itemsSelectNeighbour() }) }),
              gt: () => ({ order: () => ({ limit: () => itemsSelectNeighbour() }) }),
            }),
            // maybeSingle path for moveFoundationItemAction's first load
            maybeSingle: itemsSelectMaybeSingle,
          }),
        }),
        update: (patch: unknown) => {
          itemsUpdatePatch(patch);
          return { eq: itemsUpdateEq };
        },
        delete: () => ({ eq: () => itemsDeleteEq() }),
      };
    }
    if (table === "messaging_pillars") {
      return {
        insert: (patch: unknown) => {
          pillarsInsertPatch(patch);
          return { select: () => ({ single: pillarsInsertSingle }) };
        },
        select: () => ({
          eq: () => ({
            order: () => ({ limit: () => pillarsSelectSort() }),
          }),
        }),
      };
    }
    if (table === "marketing_snippets") {
      return {
        insert: (patch: unknown) => {
          snippetsInsertPatch(patch);
          return { select: () => ({ single: vi.fn().mockResolvedValue({ data: { id: "sn_1" }, error: null })() }) };
        },
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: () => ({ limit: async () => ({ data: [{ sort_order: 4 }] }) }),
            }),
          }),
        }),
      };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  };

  const serverClient = { from: fromBuilder };
  const requireRole = vi.fn();
  const scopedCompanyId = vi.fn();
  const revalidatePath = vi.fn();

  return {
    foundationUpsert,
    foundationUpsertSingle,
    itemsInsertPatch,
    itemsInsertSingle,
    itemsSelectMaybeSingle,
    itemsSelectListSort,
    itemsSelectNeighbour,
    itemsUpdatePatch,
    itemsUpdateEq,
    itemsDeleteEq,
    pillarsInsertPatch,
    pillarsInsertSingle,
    pillarsSelectSort,
    snippetsInsertPatch,
    serverClient,
    requireRole,
    scopedCompanyId,
    revalidatePath,
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => mocks.serverClient,
}));

vi.mock("@/lib/auth/current-user", () => ({
  requireRole: mocks.requireRole,
}));

vi.mock("@/lib/auth/permissions", () => ({
  scopedCompanyId: mocks.scopedCompanyId,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

// ---- Helpers --------------------------------------------------
function formDataFrom(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

function primeHappyPath() {
  mocks.requireRole.mockResolvedValue({
    profile: { id: "admin_1", role: "company_admin", company_id: "co_acme" },
  });
  mocks.scopedCompanyId.mockResolvedValue("co_acme");
  mocks.foundationUpsertSingle.mockResolvedValue({
    data: { company_id: "co_acme", purpose_statement: null },
    error: null,
  });
  mocks.itemsInsertSingle.mockResolvedValue({
    data: { id: "item_new" },
    error: null,
  });
  mocks.itemsSelectListSort.mockResolvedValue({ data: [{ sort_order: 4 }] });
  mocks.itemsSelectMaybeSingle.mockResolvedValue({
    data: { id: "item_1", company_id: "co_acme", kind: "core_value", sort_order: 2 },
    error: null,
  });
  mocks.itemsSelectNeighbour.mockResolvedValue({
    data: [{ id: "item_2", sort_order: 3 }],
  });
  mocks.itemsUpdateEq.mockResolvedValue({ error: null });
  mocks.itemsDeleteEq.mockResolvedValue({ error: null });
  mocks.pillarsInsertSingle.mockResolvedValue({
    data: { id: "pillar_new" },
    error: null,
  });
  mocks.pillarsSelectSort.mockResolvedValue({ data: [{ sort_order: 1 }] });
}

// ==============================================================
// upsertFoundationAction
// ==============================================================
describe("upsertFoundationAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("uses company_id as the upsert conflict target", async () => {
    // Contract: company_foundation is a singleton per company. Wrong
    // conflict target → duplicate rows and every read returns the wrong
    // one nondeterministically.
    const { upsertFoundationAction } = await import("./actions");

    await upsertFoundationAction(
      undefined,
      formDataFrom({ purpose_statement: "Help teams grow." })
    );

    expect(mocks.foundationUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ company_id: "co_acme" }),
      { onConflict: "company_id" }
    );
  });
});

// ==============================================================
// createFoundationItemAction
// ==============================================================
describe("createFoundationItemAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("rejects a kind that isn't in the whitelist", async () => {
    // A CHECK constraint would also catch this DB-side, but returning
    // early keeps the DB round-trip out of the failure path AND lets
    // us surface a friendly message instead of the raw SQL error.
    const { createFoundationItemAction } = await import("./actions");

    const res = await createFoundationItemAction(
      undefined,
      formDataFrom({ kind: "totally-fake", title: "X" })
    );

    expect(res).toEqual({ ok: false, message: "Invalid item kind." });
    expect(mocks.itemsInsertPatch).not.toHaveBeenCalled();
  });

  it("accepts each valid kind (core_value, differentiator, key_success_metric)", async () => {
    const { createFoundationItemAction } = await import("./actions");

    for (const kind of ["core_value", "differentiator", "key_success_metric"]) {
      mocks.itemsInsertPatch.mockClear();
      const res = await createFoundationItemAction(
        undefined,
        formDataFrom({ kind, title: "X" })
      );
      expect(res.ok).toBe(true);
      expect(mocks.itemsInsertPatch).toHaveBeenCalledWith(
        expect.objectContaining({ kind })
      );
    }
  });

  it("places new items at the bottom by incrementing the tail sort_order", async () => {
    // Highest existing sort_order is 4 (primed); new item should be 5.
    const { createFoundationItemAction } = await import("./actions");

    await createFoundationItemAction(
      undefined,
      formDataFrom({ kind: "core_value", title: "New value" })
    );

    const patch = mocks.itemsInsertPatch.mock.calls[0][0] as {
      sort_order: number;
    };
    expect(patch.sort_order).toBe(5);
  });

  it("uses sort_order=0 when no items of this kind exist yet", async () => {
    mocks.itemsSelectListSort.mockResolvedValueOnce({ data: [] });
    const { createFoundationItemAction } = await import("./actions");

    await createFoundationItemAction(
      undefined,
      formDataFrom({ kind: "core_value", title: "First value" })
    );

    const patch = mocks.itemsInsertPatch.mock.calls[0][0] as {
      sort_order: number;
    };
    expect(patch.sort_order).toBe(0);
  });
});

// ==============================================================
// moveFoundationItemAction — the swap dance
// ==============================================================
describe("moveFoundationItemAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("returns ok without any write when the item is already at the edge", async () => {
    // No neighbour → the item is already at the top (moving up) or the
    // bottom (moving down). Silently succeed instead of erroring — the
    // UI button was clickable, the action is a no-op.
    mocks.itemsSelectNeighbour.mockResolvedValueOnce({ data: [] });
    const { moveFoundationItemAction } = await import("./actions");

    const res = await moveFoundationItemAction("item_1", "up");

    expect(res).toEqual({ ok: true });
    expect(mocks.itemsUpdatePatch).not.toHaveBeenCalled();
  });

  it("swaps sort_order with the adjacent neighbour", async () => {
    // Item sort_order=2, neighbour sort_order=3. After swap: item=3,
    // neighbour=2. Two updates fire (order irrelevant at v1 volumes).
    const { moveFoundationItemAction } = await import("./actions");

    const res = await moveFoundationItemAction("item_1", "down");

    expect(res).toEqual({ ok: true });
    expect(mocks.itemsUpdatePatch).toHaveBeenCalledTimes(2);
    const patches = mocks.itemsUpdatePatch.mock.calls.map(
      (c) => c[0] as { sort_order: number }
    );
    expect(patches.map((p) => p.sort_order).sort()).toEqual([2, 3]);
  });
});
