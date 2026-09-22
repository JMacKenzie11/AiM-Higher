import { describe, it, expect, vi } from "vitest";

// Which role a saved document extends.
//
// The bug this pins: a second person revising a role that is not on
// the chart used to create a RIVAL role rather than the next
// version. Two rows for one job, each with its own version 1, and
// nothing saying so.
//
// It happened because identity was inferred. resolveRoleId looked
// for a version this CONVERSATION had saved, then for the role row
// matching an on-chart function, then gave up and made a new one. A
// colleague opening a revision is always in a new conversation —
// the original is private to whoever held it — so the first test
// missed, and for an off-chart role there was no function to catch
// it with.
//
// Identity is told now, not inferred: the Revise button records the
// role on the conversation (0224) and the save reads it back.

const mocks = vi.hoisted(() => ({
  rows: {} as Record<string, unknown[]>,
  inserted: [] as Array<{ table: string; values: unknown }>,
  updated: [] as Array<{ table: string; values: unknown }>,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/instances/current", () => ({
  getCurrentInstanceConfig: async () => ({ subdomain: "t" }),
}));

function chainFor(table: string) {
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => Promise.resolve({ data: mocks.rows[table] ?? [], error: null }),
    insert: (values: unknown) => {
      mocks.inserted.push({ table, values });
      return {
        select: () => ({
          single: async () => ({ data: { id: "new-role" }, error: null }),
        }),
      };
    },
    update: (values: unknown) => {
      mocks.updated.push({ table, values });
      return { eq: () => Promise.resolve({ error: null }) };
    },
    then: (r: (v: unknown) => unknown) =>
      Promise.resolve({ data: mocks.rows[table] ?? [], error: null }).then(r),
  });
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ from: chainFor }),
}));

import { __resolveRoleIdForTest as resolveRoleId } from "./save-action";

function reset() {
  mocks.rows = {};
  mocks.inserted = [];
  mocks.updated = [];
}

const BASE = {
  companyId: "co_1",
  conversationId: "convo_new",
  revisingRoleId: null as string | null,
  functionId: null as string | null,
  title: "Executive Assistant",
  supportsFunctions: [] as string[],
  createdBy: "p_1",
};

describe("which role a save extends", () => {
  it("extends the role the conversation was opened to revise", async () => {
    reset();
    mocks.rows = { role_descriptions: [{ id: "role_existing" }] };
    const db = await (
      await import("@/lib/supabase/server")
    ).createSupabaseServerClient({} as never);
    const id = await resolveRoleId(db, {
      ...BASE,
      revisingRoleId: "role_existing",
    });
    expect(id).toBe("role_existing");
    expect(mocks.inserted).toHaveLength(0);
  });

  // The whole point. Before 0224 this returned a brand new role.
  it("does NOT duplicate an off-chart role for a second reviser", async () => {
    reset();
    mocks.rows = { role_descriptions: [{ id: "role_existing" }] };
    const db = await (
      await import("@/lib/supabase/server")
    ).createSupabaseServerClient({} as never);
    const id = await resolveRoleId(db, {
      ...BASE,
      conversationId: "convo_somebody_elses",
      functionId: null,
      revisingRoleId: "role_existing",
    });
    expect(id).toBe("role_existing");
    expect(
      mocks.inserted.filter((i) => i.table === "role_descriptions")
    ).toHaveLength(0);
  });

  // A stale or tampered id must not reach across tenants. RLS would
  // refuse the insert anyway; this makes the refusal a named one.
  it("ignores a revising id that is not this company's", async () => {
    reset();
    // The company-scoped lookup finds nothing.
    mocks.rows = { role_descriptions: [] };
    const db = await (
      await import("@/lib/supabase/server")
    ).createSupabaseServerClient({} as never);
    const id = await resolveRoleId(db, {
      ...BASE,
      revisingRoleId: "role_from_another_company",
    });
    expect(id).toBe("new-role");
  });

  it("still starts a new role for a fresh off-chart document", async () => {
    reset();
    mocks.rows = {};
    const db = await (
      await import("@/lib/supabase/server")
    ).createSupabaseServerClient({} as never);
    const id = await resolveRoleId(db, BASE);
    expect(id).toBe("new-role");
    expect(
      mocks.inserted.filter((i) => i.table === "role_descriptions")
    ).toHaveLength(1);
  });
});
