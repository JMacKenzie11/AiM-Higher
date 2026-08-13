import { describe, it, expect, beforeEach, vi } from "vitest";
import { scoreFoundation } from "./foundation";

// Foundation scorer pinning tests. Two points each for:
//   purpose, vision, ≥3 core_values, ≥3 differentiators, ≥3 key_success_metrics
// Max 10. Fewer than 3 in a values bucket earns 0 for that bucket
// (no partial credit — the rule is "at least three or nothing").

function fakeAdmin(config: {
  foundation: {
    purpose_statement: string | null;
    vision: string | null;
  } | null;
  items: Array<{ kind: string }>;
}) {
  return {
    from: (table: string) => {
      if (table === "company_foundation") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: config.foundation, error: null }),
            }),
          }),
        };
      }
      if (table === "foundation_items") {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: config.items, error: null }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
    // Cast escape hatch so the real function's SupabaseClient type
    // accepts our shim without pulling in the whole client type.
  } as unknown as Parameters<typeof scoreFoundation>[0];
}

describe("scoreFoundation", () => {
  it("returns 0 for a brand-new company with nothing filled in", async () => {
    const admin = fakeAdmin({ foundation: null, items: [] });

    const result = await scoreFoundation(admin, "co_1");

    expect(result.score).toBe(0);
    expect(result.breakdown).toEqual({
      purpose: false,
      vision: false,
      values: 0,
      differentiators: 0,
      successMetrics: 0,
    });
  });

  it("gives 2 pts for purpose + 2 pts for vision but 0 for a 2-item values list", async () => {
    // Two values isn't three — no credit. This is the "at least three
    // or nothing" contract; partial credit would let a company get 1
    // core value and coast on that.
    const admin = fakeAdmin({
      foundation: {
        purpose_statement: "Help teams grow.",
        vision: "The clearest chart in construction.",
      },
      items: [
        { kind: "core_value" },
        { kind: "core_value" },
      ],
    });

    const result = await scoreFoundation(admin, "co_1");

    expect(result.score).toBe(4);
    expect(result.breakdown).toEqual({
      purpose: true,
      vision: true,
      values: 2,
      differentiators: 0,
      successMetrics: 0,
    });
  });

  it("hits a perfect 10 when all five criteria pass", async () => {
    const admin = fakeAdmin({
      foundation: {
        purpose_statement: "Help teams grow.",
        vision: "The clearest chart in construction.",
      },
      items: [
        { kind: "core_value" },
        { kind: "core_value" },
        { kind: "core_value" },
        { kind: "differentiator" },
        { kind: "differentiator" },
        { kind: "differentiator" },
        { kind: "key_success_metric" },
        { kind: "key_success_metric" },
        { kind: "key_success_metric" },
      ],
    });

    const result = await scoreFoundation(admin, "co_1");

    expect(result.score).toBe(10);
    expect(result.breakdown).toEqual({
      purpose: true,
      vision: true,
      values: 3,
      differentiators: 3,
      successMetrics: 3,
    });
  });

  it("treats whitespace-only purpose/vision as empty", async () => {
    const admin = fakeAdmin({
      foundation: { purpose_statement: "   ", vision: "\n\n" },
      items: [],
    });

    const result = await scoreFoundation(admin, "co_1");

    expect(result.score).toBe(0);
  });
});
