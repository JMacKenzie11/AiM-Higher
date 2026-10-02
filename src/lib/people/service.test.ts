import { describe, it, expect, vi } from "vitest";

// A person's page leaves out deleted and parked commitments, like every
// other page (Jason, 2026-10-02). Casey's page on production listed five
// deleted commitments as open, three of them "Past due", that the
// Commitments page rightly did not show.

const mocks = vi.hoisted(() => {
  // Every query on commitments, with the filters it was given.
  const commitmentReads: Array<Array<[string, unknown[]]>> = [];
  const chain = (table: string, data: unknown) => {
    const calls: Array<[string, unknown[]]> = [];
    if (table === "commitments") commitmentReads.push(calls);
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "is", "gte", "lte", "in", "order"]) {
      c[m] = (...args: unknown[]) => {
        calls.push([m, args]);
        return c;
      };
    }
    c.maybeSingle = async () => ({ data });
    c.then = (resolve: (v: unknown) => void) => resolve({ data: [] });
    return c;
  };
  return {
    commitmentReads,
    client: {
      from: (table: string) =>
        chain(
          table,
          table === "profiles"
            ? { id: "p1", company_id: "co1", full_name: "Casey" }
            : { id: "co1", name: "Benson", timezone: "America/Halifax" }
        ),
    },
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => mocks.client }));
vi.mock("@/lib/instances/current", () => ({ getCurrentInstanceConfig: () => ({}) }));
vi.mock("@/lib/quarters/service", () => ({
  getCurrentQuarter: async () => ({ id: "q1", start_date: "2026-07-01", end_date: "2026-09-30" }),
}));

import { getPersonScorecard } from "./service";

describe("getPersonScorecard", () => {
  it("leaves deleted and parked commitments out of every read", async () => {
    await getPersonScorecard("p1");
    expect(mocks.commitmentReads.length).toBeGreaterThanOrEqual(4);
    for (const calls of mocks.commitmentReads) {
      expect(calls, JSON.stringify(calls)).toContainEqual(["is", ["deleted_at", null]]);
      expect(calls, JSON.stringify(calls)).toContainEqual(["is", ["parked_at", null]]);
    }
  });
});
