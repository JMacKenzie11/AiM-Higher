import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock("@/lib/instances/current", () => ({ getCurrentInstanceConfig: vi.fn() }));

import { estimateCostCents } from "./usage";

// Rates from platform.claude.com/docs/en/about-claude/pricing,
// 2026-10-14. A million tokens in and a million out make each rate
// readable straight off the answer, in cents.
const million = { input_tokens: 1_000_000, output_tokens: 1_000_000 };

describe("estimateCostCents", () => {
  it("prices Opus 5.5 at its own rate, which the meeting pipeline runs on", () => {
    // $4 in + $20 out. Before 0285 it fell back to Sonnet 5: $12.
    expect(estimateCostCents("claude-opus-5-5", million)).toBe(2400);
  });

  it("keeps a longer id from being caught by a shorter one that prefixes it", () => {
    expect(estimateCostCents("claude-opus-5", million)).toBe(3000);
    expect(estimateCostCents("claude-sonnet-5-5", { cache_read_input_tokens: 1_000_000 })).toBe(10);
    expect(estimateCostCents("claude-sonnet-5", { cache_read_input_tokens: 1_000_000 })).toBe(20);
  });

  it("prices Haiku 5.5 at a tenth of Haiku 4.5", () => {
    // 100,000 each way: at the long-prompt threshold, not past it.
    const tenth = { input_tokens: 100_000, output_tokens: 100_000 };
    expect(estimateCostCents("claude-haiku-5-5", tenth)).toBe(6);
    expect(estimateCostCents("claude-haiku-4-5", tenth)).toBe(60);
    // The dated id old rows carry.
    expect(estimateCostCents("claude-haiku-4-5-20251001", tenth)).toBe(60);
  });

  it("charges Haiku 5.5's long-prompt rate past 100,000 prompt tokens, cache included", () => {
    const short = { input_tokens: 60_000, cache_read_input_tokens: 40_000, output_tokens: 1_000 };
    const long = { input_tokens: 60_000, cache_read_input_tokens: 40_001, output_tokens: 1_000 };
    // 0.6 + 0.04 + 0.05 cents, then the same tokens at five times the rate.
    expect(estimateCostCents("claude-haiku-5-5", short)).toBe(0.69);
    expect(estimateCostCents("claude-haiku-5-5", long)).toBeCloseTo(3.45, 3);
  });

  it("keeps fractions of a cent, so a Haiku call is never free", () => {
    // A commitment clarity check's typical size on production.
    expect(estimateCostCents("claude-haiku-5-5", { input_tokens: 317, output_tokens: 47 })).toBe(0.0055);
  });

  it("prices an unknown model at the dearest rate in use, never lower", () => {
    expect(estimateCostCents("claude-something-new", million)).toBe(2400);
  });
});
