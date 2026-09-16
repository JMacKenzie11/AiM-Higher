import { describe, it, expect } from "vitest";
import { scorePlanning } from "./planning";
import type { SupabaseClient } from "@supabase/supabase-js";

// Planning scorer.
//
//   cascade populated        → 2 pts
//   goal closure by target   → 4 pts
//   priority closure by due  → 4 pts
//
// THE BUG THESE PIN. "Populated" used to require focus areas AND
// goals AND priorities. Migration 0209 made goals optional: a
// company whose focus area lives for a single quarter hangs its
// priorities straight off the focus area and never creates a goal.
// That shape scored ZERO — not 8, not 6, zero — because the two
// closure halves sit behind the same gate. The company doing what
// the product tells it to do was the company being told its
// planning discipline did not exist.

type Row = Record<string, unknown>;

// The scorer issues four reads in a fixed order: the open quarter,
// then focus areas, goals and priorities in one Promise.all. The
// fake answers by table name, which keeps the test readable when a
// case wants "no goals at all".
function fakeAdmin(tables: {
  quarter?: Row | null;
  sfas?: Row[];
  goals?: Row[];
  priorities?: Row[];
}) {
  return {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      const pass = () => chain;
      Object.assign(chain, {
        select: pass,
        eq: pass,
        maybeSingle: () =>
          Promise.resolve({
            data: tables.quarter === undefined ? { id: "q_1" } : tables.quarter,
            error: null,
          }),
        then: (resolve: (v: unknown) => unknown) => {
          const data =
            table === "strategic_focus_areas"
              ? (tables.sfas ?? [])
              : table === "annual_goals"
                ? (tables.goals ?? [])
                : (tables.priorities ?? []);
          return Promise.resolve({ data, error: null }).then(resolve);
        },
      });
      return chain;
    },
  } as unknown as SupabaseClient;
}

const FUTURE = "2999-01-01";
const PAST = "2000-01-01";

describe("scorePlanning", () => {
  it("scores a focus-area-and-priorities plan with NO goals", async () => {
    // The 0209 shape. Nothing past due, so both closure halves pay
    // out in full: 2 + 4 + 4.
    const result = await scorePlanning(
      fakeAdmin({
        sfas: [{ id: "s_1" }],
        goals: [],
        priorities: [{ id: "p_1", due_date: FUTURE, status: "on_track" }],
      }),
      "co_1"
    );

    expect(result.score).toBe(10);
    expect(result.breakdown.goals).toBe(0);
  });

  it("still scores zero when there are no priorities", async () => {
    // Priorities are the level the quarter is executed in. A focus
    // area on its own is a heading, not a plan, and must not read as
    // 8/10 through the "nothing past due yet" branch.
    const result = await scorePlanning(
      fakeAdmin({ sfas: [{ id: "s_1" }], goals: [], priorities: [] }),
      "co_1"
    );

    expect(result.score).toBe(0);
  });

  it("still scores zero when there are no focus areas", async () => {
    const result = await scorePlanning(
      fakeAdmin({
        sfas: [],
        goals: [],
        priorities: [{ id: "p_1", due_date: FUTURE, status: "on_track" }],
      }),
      "co_1"
    );

    expect(result.score).toBe(0);
  });

  it("scores zero with no open quarter, whatever the cascade holds", async () => {
    const result = await scorePlanning(
      fakeAdmin({
        quarter: null,
        sfas: [{ id: "s_1" }],
        priorities: [{ id: "p_1", due_date: FUTURE, status: "on_track" }],
      }),
      "co_1"
    );

    expect(result.score).toBe(0);
    expect(result.breakdown.openQuarter).toBe(false);
  });

  it("still penalises past-due work that was never closed", async () => {
    // Goals being optional must not make closure optional. One goal
    // past its target and not complete, one priority past due and
    // not complete: both halves score zero, leaving the baseline.
    const result = await scorePlanning(
      fakeAdmin({
        sfas: [{ id: "s_1" }],
        goals: [{ id: "g_1", target_date: PAST, status: "on_track" }],
        priorities: [{ id: "p_1", due_date: PAST, status: "on_track" }],
      }),
      "co_1"
    );

    expect(result.score).toBe(2);
    expect(result.breakdown.goalClosureRate).toBe(0);
    expect(result.breakdown.priorityClosureRate).toBe(0);
  });

  it("pays the goal half in full when every past-target goal is complete", async () => {
    const result = await scorePlanning(
      fakeAdmin({
        sfas: [{ id: "s_1" }],
        goals: [{ id: "g_1", target_date: PAST, status: "complete" }],
        priorities: [{ id: "p_1", due_date: FUTURE, status: "on_track" }],
      }),
      "co_1"
    );

    expect(result.score).toBe(10);
  });
});
