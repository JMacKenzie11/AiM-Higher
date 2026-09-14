import { describe, it, expect } from "vitest";
import { scoreExecution } from "./execution";
import type { SupabaseClient } from "@supabase/supabase-js";

// Execution scorer.
//
//   follow-through rate (kept / (kept + missed))  → 7 pts
//   aging opens (0.5 each, capped at 3)           → 3 pts
//
// THE BUG THESE PIN. Neither query filtered deleted_at or parked_at,
// and this was the only follow-through path in the product where that
// was true. Deleting a commitment is supposed to remove it from every
// list, count and metric; here it went on costing 0.5 points a week
// forever, because the aging query has no window for a row to age out
// of.
//
// Measured on production before the fix: 31 soft-deleted commitments
// counted as aging across five companies, and four of eight companies
// were scoring BELOW what they had earned — by 1.5 to 3.0 points.

// Records the filters each query applied, so a test can assert that
// the exclusion is in the QUERY rather than done in Node afterwards.
// A scorer that fetched everything and filtered in memory would pass
// a behavioural test and still ship the row count over the wire.
type Row = Record<string, unknown>;

function fakeAdmin(rows: { resolved: Row[]; open: Row[] }) {
  const filters: string[][] = [];
  return {
    client: {
      from: () => {
        const applied: string[] = [];
        filters.push(applied);
        const chain: Record<string, unknown> = {};
        const note =
          (op: string) =>
          (...args: unknown[]) => {
            applied.push(`${op}:${String(args[0])}`);
            return chain;
          };
        Object.assign(chain, {
          select: (cols: string) => {
            applied.push(`select:${cols}`);
            return chain;
          },
          eq: note("eq"),
          in: note("in"),
          is: note("is"),
          gte: note("gte"),
          then: (resolve: (v: unknown) => unknown) =>
            Promise.resolve({
              data: applied.some((f) => f.startsWith("select:status"))
                ? rows.resolved
                : rows.open,
              error: null,
            }).then(resolve),
        });
        return chain;
      },
    } as unknown as SupabaseClient,
    filters,
  };
}

const daysAgo = (n: number) =>
  new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

describe("scoreExecution", () => {
  it("excludes deleted and parked rows in the QUERY, not in memory", async () => {
    const { client, filters } = fakeAdmin({ resolved: [], open: [] });

    await scoreExecution(client, "co_1");

    // Both queries, both filters, every time.
    expect(filters).toHaveLength(2);
    for (const applied of filters) {
      expect(applied).toContain("is:deleted_at");
      expect(applied).toContain("is:parked_at");
    }
  });

  it("scores a clean sheet at full marks", async () => {
    const { client } = fakeAdmin({
      resolved: [{ status: "kept_on_time" }, { status: "kept_on_time" }],
      open: [],
    });

    const result = await scoreExecution(client, "co_1");

    // rate 1.0 * 7 + full 3 for no aging.
    expect(result.score).toBe(10);
  });

  it("counts kept_late as kept, not as missed", async () => {
    // "Did the work" is the question here; the on-time-only rate is a
    // different measure computed elsewhere.
    const { client } = fakeAdmin({
      resolved: [{ status: "kept_late" }, { status: "kept_late" }],
      open: [],
    });

    expect((await scoreExecution(client, "co_1")).score).toBe(10);
  });

  it("halves the follow-through points at a 50% rate", async () => {
    const { client } = fakeAdmin({
      resolved: [{ status: "kept_on_time" }, { status: "missed" }],
      open: [],
    });

    // 0.5 * 7 + 3 = 6.5
    expect((await scoreExecution(client, "co_1")).score).toBe(6.5);
  });

  it("charges half a point per aging open", async () => {
    const { client } = fakeAdmin({
      resolved: [{ status: "kept_on_time" }],
      open: [{ due_date: daysAgo(30) }, { due_date: daysAgo(30) }],
    });

    // 7 + (3 - 2*0.5) = 9
    expect((await scoreExecution(client, "co_1")).score).toBe(9);
  });

  it("caps the aging penalty at 3 points", async () => {
    // A large backlog must not drive the whole discipline to zero by
    // itself — B&B Electric sat above this cap, which is why the bug
    // was invisible there.
    const { client } = fakeAdmin({
      resolved: [{ status: "kept_on_time" }],
      open: Array.from({ length: 20 }, () => ({ due_date: daysAgo(60) })),
    });

    expect((await scoreExecution(client, "co_1")).score).toBe(7);
  });

  it("does not charge for an open commitment that is not yet aging", async () => {
    const { client } = fakeAdmin({
      resolved: [{ status: "kept_on_time" }],
      open: [{ due_date: daysAgo(3) }],
    });

    expect((await scoreExecution(client, "co_1")).score).toBe(10);
  });

  it("does not charge for an open commitment with no due date", async () => {
    const { client } = fakeAdmin({
      resolved: [{ status: "kept_on_time" }],
      open: [{ due_date: null }],
    });

    expect((await scoreExecution(client, "co_1")).score).toBe(10);
  });
});
