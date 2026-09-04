import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { scoreMeasures } from "./measures";
import type { SupabaseClient } from "@supabase/supabase-js";

// CHARACTERISATION TESTS for the Success Tracking discipline scorer.
//
// This score feeds the AiMS Scorecard and the Guide HQ attention
// triggers, so a change here moves a number guides act on. The
// CSF/KPI refactor rewires how it finds measures: today it walks
// functions → function_outcomes → success_measures, and afterwards it
// reads measures by function and kind. The arithmetic must not move
// while the plumbing does.
//
// The formula, pinned below:
//   share with a target      × 3 pts
//   share logged in 7 days   × 5 pts
//   auto_track rows with no recent entry: −0.5 each, capped at −2
// Cadence dominates on purpose. A target nobody logs against says
// nothing about how the business is running.

const FROZEN_NOW = new Date("2026-09-02T18:00:00Z");

function fakeAdmin(config: {
  functions?: Array<{ id: string }>;
  outcomes?: Array<{ id: string }>;
  measures?: Array<{ id: string; target: string | null; auto_track: boolean }>;
  entries?: Array<{ measure_id: string }>;
}) {
  const rows: Record<string, unknown[]> = {
    functions: config.functions ?? [],
    function_outcomes: config.outcomes ?? [],
    success_measures: config.measures ?? [],
    success_measure_entries: config.entries ?? [],
  };
  const make = (table: string) => {
    const chain: Record<string, unknown> = {};
    const pass = () => chain;
    Object.assign(chain, {
      select: pass,
      eq: pass,
      in: pass,
      gte: pass,
      then: (res: (v: unknown) => unknown) =>
        Promise.resolve({ data: rows[table] ?? [] }).then(res),
    });
    return chain;
  };
  return { from: (t: string) => make(t) } as unknown as SupabaseClient;
}

function m(id: string, target: string | null, auto_track = true) {
  return { id, target, auto_track };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FROZEN_NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("scoreMeasures — the empty ladder", () => {
  it("scores 0 with an empty breakdown when the company has no functions", async () => {
    const result = await scoreMeasures(fakeAdmin({ functions: [] }), "co_1");

    expect(result.score).toBe(0);
    expect(result.breakdown).toMatchObject({
      totalMeasures: 0,
      withTarget: 0,
      withRecentEntry: 0,
      autoTrackGaps: 0,
    });
  });

  it("scores 0 when functions exist but carry no KPIs", async () => {
    // Since the move to reading by function + kind, the scorer no
    // longer walks function_outcomes at all. The outcome fixture is
    // retained only to prove its absence changes nothing.
    const result = await scoreMeasures(
      fakeAdmin({ functions: [{ id: "f_1" }], outcomes: [], measures: [] }),
      "co_1"
    );

    expect(result.score).toBe(0);
    expect(result.breakdown).toMatchObject({ totalMeasures: 0 });
  });

  it("scores 0 when outcomes exist but carry no measures", async () => {
    const result = await scoreMeasures(
      fakeAdmin({
        functions: [{ id: "f_1" }],
        outcomes: [{ id: "o_1" }],
        measures: [],
      }),
      "co_1"
    );

    expect(result.score).toBe(0);
    expect(result.breakdown).toMatchObject({ totalMeasures: 0 });
  });
});

describe("scoreMeasures — the formula", () => {
  it("gives full marks when every measure has a target and a recent entry", async () => {
    // 1.0 × 3 + 1.0 × 5 = 8, no gaps.
    const result = await scoreMeasures(
      fakeAdmin({
        functions: [{ id: "f_1" }],
        outcomes: [{ id: "o_1" }],
        measures: [m("m_1", "95"), m("m_2", "10")],
        entries: [{ measure_id: "m_1" }, { measure_id: "m_2" }],
      }),
      "co_1"
    );

    expect(result.score).toBe(8);
    expect(result.breakdown).toMatchObject({
      totalMeasures: 2,
      withTarget: 2,
      withRecentEntry: 2,
      autoTrackGaps: 0,
      targetPct: 100,
      cadencePct: 100,
    });
  });

  it("weights cadence above targets", async () => {
    // All targets, nothing logged: 3 points earned, then two
    // auto_track gaps dock 1. Cadence is the bigger lever by design.
    const targetsOnly = await scoreMeasures(
      fakeAdmin({
        functions: [{ id: "f_1" }],
        outcomes: [{ id: "o_1" }],
        measures: [m("m_1", "95"), m("m_2", "10")],
        entries: [],
      }),
      "co_1"
    );

    // No targets, everything logged: 5 points, no gaps.
    const cadenceOnly = await scoreMeasures(
      fakeAdmin({
        functions: [{ id: "f_1" }],
        outcomes: [{ id: "o_1" }],
        measures: [m("m_1", null), m("m_2", null)],
        entries: [{ measure_id: "m_1" }, { measure_id: "m_2" }],
      }),
      "co_1"
    );

    expect(targetsOnly.score).toBe(2);
    expect(cadenceOnly.score).toBe(5);
    // score is number | null on the DisciplineScore type; both are
    // non-null here, and the point of the assertion is the ordering.
    expect(cadenceOnly.score ?? 0).toBeGreaterThan(targetsOnly.score ?? 0);
  });

  it("treats a blank or whitespace target as no target", async () => {
    const result = await scoreMeasures(
      fakeAdmin({
        functions: [{ id: "f_1" }],
        outcomes: [{ id: "o_1" }],
        measures: [m("m_1", "   "), m("m_2", "")],
        entries: [{ measure_id: "m_1" }, { measure_id: "m_2" }],
      }),
      "co_1"
    );

    expect(result.breakdown).toMatchObject({ withTarget: 0, targetPct: 0 });
    expect(result.score).toBe(5);
  });
});

describe("scoreMeasures — the auto_track penalty", () => {
  it("docks half a point per unlogged auto_track measure", async () => {
    // 3 measures, all targeted, 1 logged.
    // 3 + (1/3 × 5 = 1.667) = 4.667, minus 2 gaps × 0.5 = 3.667 → 3.7
    const result = await scoreMeasures(
      fakeAdmin({
        functions: [{ id: "f_1" }],
        outcomes: [{ id: "o_1" }],
        measures: [m("m_1", "1"), m("m_2", "1"), m("m_3", "1")],
        entries: [{ measure_id: "m_1" }],
      }),
      "co_1"
    );

    expect(result.breakdown).toMatchObject({ autoTrackGaps: 2 });
    expect(result.score).toBeCloseTo(3.7, 1);
  });

  it("caps the penalty at 2 points however many gaps there are", async () => {
    // 8 unlogged auto_track measures would be −4 uncapped.
    const measures = Array.from({ length: 8 }, (_, i) => m(`m_${i}`, "1"));
    const result = await scoreMeasures(
      fakeAdmin({
        functions: [{ id: "f_1" }],
        outcomes: [{ id: "o_1" }],
        measures,
        entries: [],
      }),
      "co_1"
    );

    // 3 (all targeted) + 0 cadence − 2 capped = 1.
    expect(result.breakdown).toMatchObject({ autoTrackGaps: 8 });
    expect(result.score).toBe(1);
  });

  it("exempts measures with auto_track off from the penalty", async () => {
    // Context measures like headcount are worth tracking but should
    // not be treated as a broken weekly commitment.
    const result = await scoreMeasures(
      fakeAdmin({
        functions: [{ id: "f_1" }],
        outcomes: [{ id: "o_1" }],
        measures: [m("m_1", "1", false), m("m_2", "1", false)],
        entries: [],
      }),
      "co_1"
    );

    expect(result.breakdown).toMatchObject({ autoTrackGaps: 0 });
    expect(result.score).toBe(3);
  });

  it("never returns a negative score", async () => {
    const measures = Array.from({ length: 6 }, (_, i) => m(`m_${i}`, null));
    const result = await scoreMeasures(
      fakeAdmin({
        functions: [{ id: "f_1" }],
        outcomes: [{ id: "o_1" }],
        measures,
        entries: [],
      }),
      "co_1"
    );

    // 0 targets, 0 cadence, −2 capped penalty → clamped to 0.
    expect(result.score).toBe(0);
  });
});

describe("scoreMeasures — deduplication", () => {
  it("counts a measure once however many entries it has in the window", async () => {
    const result = await scoreMeasures(
      fakeAdmin({
        functions: [{ id: "f_1" }],
        outcomes: [{ id: "o_1" }],
        measures: [m("m_1", "1"), m("m_2", "1")],
        entries: [
          { measure_id: "m_1" },
          { measure_id: "m_1" },
          { measure_id: "m_1" },
        ],
      }),
      "co_1"
    );

    expect(result.breakdown).toMatchObject({
      withRecentEntry: 1,
      autoTrackGaps: 1,
    });
  });
});
