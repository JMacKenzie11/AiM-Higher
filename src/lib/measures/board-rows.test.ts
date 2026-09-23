import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// What the 13-week board plots.
//
// One row per critical success factor, in the function's own order.
//
// This file used to pin the two-level version: a CSF row leading the
// KPIs beneath it, each row marked with its kind, and each group kept
// together rather than interleaved. 0216 collapsed the kinds, so what
// is left to guarantee is simpler and, it turns out, easier to get
// wrong quietly: every measure appears, in sort_order, with its own
// target and its own thirteen cells.
//
// THE ORDER MATTERS MORE NOW, not less. Grouping used to impose an
// order regardless of what sort_order said. Nothing imposes one any
// more, so a board that sorted by id, or by whatever the query
// returned, would look perfectly reasonable and put a company's rows
// in an order it never chose.

const FROZEN_NOW = new Date("2026-09-02T18:00:00Z"); // a Wednesday
const THIS_FRIDAY = "2026-09-04";

const mocks = vi.hoisted(() => {
  const rows = new Map<string, unknown[]>();
  return { rows };
});

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => {
    const make = (table: string) => {
      let key = table;
      const chain: Record<string, unknown> = {};
      const pass = () => () => chain;
      Object.assign(chain, {
        // success_measures is queried twice with different column
        // lists, so fixtures key on table plus select string.
        select: (cols: string) => {
          key = `${table}::${cols}`;
          return chain;
        },
        eq: pass(),
        neq: pass(),
        in: pass(),
        is: pass(),
        gte: pass(),
        lte: pass(),
        order: pass(),
        limit: pass(),
        then: (res: (v: unknown) => unknown) =>
          Promise.resolve({
            data: mocks.rows.get(key) ?? mocks.rows.get(table) ?? [],
          }).then(res),
      });
      return chain;
    };
    return { from: (table: string) => make(table) };
  },
}));

// The board no longer issues its own queries: it shapes rows fetched
// by loadMeasuresSpine, which selects the SUPERSET both consumers
// need (the Manager tree's list, of which the board's old list was a
// strict subset). These constants key the fixtures, so they track the
// spine's column lists rather than the board's former ones. No
// projection widened — nothing selected here goes unread by one
// consumer or the other.
const CSF_COLS =
  "id, description, detail, target, value_type, value_scale, target_direction, update_frequency, target_hint, function_id, sort_order, created_at, show_on_dashboard";

function seed(table: string, value: unknown[]) {
  mocks.rows.set(table, value);
}

function csf(
  id: string,
  description: string,
  function_id: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    id,
    description,
    function_id,
    target: "90",
    value_type: "number",
    target_direction: "higher_is_better",
    sort_order: 0,
    created_at: "2026-01-02T00:00:00Z",
    // On the board unless a test says otherwise, which is the
    // column's own default. A measure is added expecting to be seen.
    show_on_dashboard: true,
    ...overrides,
  };
}

let getBoardData: typeof import("./board").getBoardData;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(FROZEN_NOW);
  mocks.rows.clear();
  ({ getBoardData } = await import("./board"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
});

describe("getBoardData — critical success factors are plotted rows", () => {
  beforeEach(() => {
    seed("functions", [
      { id: "f1", title: "Sales", lead_id: null, parent_function_id: null, sort_order: 0 },
    ]);
    seed("profiles", []);
    seed(`success_measures::${CSF_COLS}`, [
      csf("c1", "Revenue growth", "f1", { sort_order: 0 }),
      csf("c2", "Discovery calls booked", "f1", {
        sort_order: 1,
        target: "5",
      }),
    ]);
    seed("success_measure_entries", []);
  });

  it("plots every measure the function has", async () => {
    const board = await getBoardData("co1", "America/Toronto");
    const names = board.functions[0].metrics.map((m) => m.description);
    expect(names).toEqual(["Revenue growth", "Discovery calls booked"]);
  });

  it("orders rows by sort_order, not by the order they arrive", async () => {
    // Seeded backwards on purpose. Nothing groups rows any more, so
    // the only thing standing between a company and an arbitrary
    // order is this sort.
    seed(`success_measures::${CSF_COLS}`, [
      csf("c2", "Discovery calls booked", "f1", { sort_order: 1 }),
      csf("c1", "Revenue growth", "f1", { sort_order: 0 }),
    ]);
    const board = await getBoardData("co1", "America/Toronto");
    expect(board.functions[0].metrics.map((m) => m.description)).toEqual([
      "Revenue growth",
      "Discovery calls booked",
    ]);
  });

  it("carries each measure's own target onto its row", async () => {
    const board = await getBoardData("co1", "America/Toronto");
    const row = board.functions[0].metrics[0];
    expect(row.target).toBe("90");
    expect(row.targetNumeric).toBe(90);
  });

  it("plots a measure with no target at all", async () => {
    // Most rows on the fleet have none. A board that dropped them
    // would hide most of a company's list.
    seed(`success_measures::${CSF_COLS}`, [
      csf("c1", "Zero lost time", "f1", { target: null }),
    ]);
    const board = await getBoardData("co1", "America/Toronto");
    expect(board.functions[0].metrics.map((m) => m.description)).toEqual([
      "Zero lost time",
    ]);
    expect(board.functions[0].metrics[0].targetNumeric).toBeNull();
  });

  it("gives every row a cell for every week on the board", async () => {
    const board = await getBoardData("co1", "America/Toronto");
    const row = board.functions[0].metrics[0];
    expect(row.cells).toHaveLength(13);
    expect(row.cells.at(-1)?.weekEnding).toBe(THIS_FRIDAY);
  });

  it("reads a logged value into its cell", async () => {
    seed("success_measure_entries", [
      { measure_id: "c1", week_ending: THIS_FRIDAY, value_number: 95, value_text: null },
    ]);
    const board = await getBoardData("co1", "America/Toronto");
    const row = board.functions[0].metrics[0];
    expect(row.cells.at(-1)?.status).toBe("good");
    expect(row.cells.at(-1)?.numericValue).toBe(95);
  });

  it("no longer marks a row with a kind", async () => {
    // The chip that read this is gone from CockpitGrid. If the field
    // comes back, something has reintroduced a distinction the model
    // does not have.
    const board = await getBoardData("co1", "America/Toronto");
    expect(board.functions[0].metrics[0]).not.toHaveProperty("kind");
    expect(board.functions[0].metrics[0]).not.toHaveProperty("outcomeTitle");
  });
});

describe("getBoardData — several measures in one function", () => {
  it("keeps the company's own order across the whole list", async () => {
    // This used to assert that each CSF stayed with its own KPIs
    // rather than interleaving. There is nothing to interleave now,
    // so what it guards is that 0216's renumbering is respected end
    // to end rather than only within some group.
    seed("functions", [
      { id: "f1", title: "Ops", lead_id: null, parent_function_id: null, sort_order: 0 },
    ]);
    seed("profiles", []);
    seed(`success_measures::${CSF_COLS}`, [
      csf("c1", "On-time delivery", "f1", { sort_order: 0 }),
      csf("k1", "Jobs scheduled a week out", "f1", { sort_order: 1 }),
      csf("c2", "Rework rate", "f1", { sort_order: 2 }),
      csf("k2", "Inspections passed first time", "f1", { sort_order: 3 }),
    ]);
    seed("success_measure_entries", []);

    const board = await getBoardData("co1", "America/Toronto");
    expect(board.functions[0].metrics.map((m) => m.description)).toEqual([
      "On-time delivery",
      "Jobs scheduled a week out",
      "Rework rate",
      "Inspections passed first time",
    ]);
  });

  it("keeps each function's measures to that function", async () => {
    seed("functions", [
      { id: "f1", title: "Ops", lead_id: null, parent_function_id: null, sort_order: 0 },
      { id: "f2", title: "Sales", lead_id: null, parent_function_id: null, sort_order: 1 },
    ]);
    seed("profiles", []);
    seed(`success_measures::${CSF_COLS}`, [
      csf("a", "Rework rate", "f1", { sort_order: 0 }),
      csf("b", "Pipeline", "f2", { sort_order: 0 }),
    ]);
    seed("success_measure_entries", []);

    const board = await getBoardData("co1", "America/Toronto");
    expect(board.functions[0].metrics.map((m) => m.description)).toEqual([
      "Rework rate",
    ]);
    expect(board.functions[1].metrics.map((m) => m.description)).toEqual([
      "Pipeline",
    ]);
  });
});
