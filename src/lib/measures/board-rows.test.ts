import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// What the 13-week board plots.
//
// Before the CSF/KPI split, a critical success factor was only a
// heading: it had a name and nothing else, so the board drew a row
// per KPI and used the CSF's title as a group label. Migration 0166
// made CSFs measurable — they carry a target, a value type and a
// weekly entry exactly like a KPI does.
//
// The board did not follow. It kept plotting KPIs only, which meant
// the numbers a function is actually held to were absent from the
// one screen built to show whether a function is on track. These
// tests pin that a CSF is now a plotted row in its own right, that
// it leads the KPIs beneath it, and that it is marked as a CSF so
// the two kinds don't read as one flat list.

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

const CSF_COLS =
  "id, description, function_id, target, value_type, target_direction, sort_order";
const KPI_COLS =
  "id, description, target, value_type, target_direction, sort_order";

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
    ...overrides,
  };
}

function kpi(
  id: string,
  description: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    id,
    description,
    target: "5",
    value_type: "number",
    target_direction: "higher_is_better",
    sort_order: 0,
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
      csf("c1", "Revenue growth", "f1"),
    ]);
    seed("csf_kpi_links", [{ csf_id: "c1", kpi_id: "k1" }]);
    seed(`success_measures::${KPI_COLS}`, [kpi("k1", "Discovery calls booked")]);
    seed("success_measure_entries", []);
  });

  it("includes the CSF as a row, not only as a group label", async () => {
    const board = await getBoardData("co1", "America/Toronto");
    const names = board.functions[0].metrics.map((m) => m.description);
    expect(names).toContain("Revenue growth");
  });

  it("puts the CSF above the KPIs that drive it", async () => {
    const board = await getBoardData("co1", "America/Toronto");
    expect(board.functions[0].metrics.map((m) => m.description)).toEqual([
      "Revenue growth",
      "Discovery calls booked",
    ]);
  });

  it("marks which kind each row is", async () => {
    const board = await getBoardData("co1", "America/Toronto");
    expect(board.functions[0].metrics.map((m) => m.kind)).toEqual(["csf", "kpi"]);
  });

  it("carries the CSF's own target onto its row", async () => {
    const board = await getBoardData("co1", "America/Toronto");
    const row = board.functions[0].metrics.find((m) => m.kind === "csf");
    expect(row?.target).toBe("90");
    expect(row?.targetNumeric).toBe(90);
  });

  it("groups the CSF under itself so it heads its own set", async () => {
    const board = await getBoardData("co1", "America/Toronto");
    const row = board.functions[0].metrics.find((m) => m.kind === "csf");
    expect(row?.outcomeTitle).toBe("Revenue growth");
  });

  it("plots a CSF that has no KPIs beneath it yet", async () => {
    // A function can name the result it owns before anyone has worked
    // out the lead measures. That CSF still has to appear, or the
    // board silently drops a function's only tracked number.
    seed("csf_kpi_links", []);
    seed(`success_measures::${KPI_COLS}`, []);
    const board = await getBoardData("co1", "America/Toronto");
    expect(board.functions[0].metrics.map((m) => m.description)).toEqual([
      "Revenue growth",
    ]);
  });

  it("gives the CSF row a cell for every week on the board", async () => {
    const board = await getBoardData("co1", "America/Toronto");
    const row = board.functions[0].metrics.find((m) => m.kind === "csf");
    expect(row?.cells).toHaveLength(13);
    expect(row?.cells.at(-1)?.weekEnding).toBe(THIS_FRIDAY);
  });

  it("reads a logged CSF value into its cell", async () => {
    seed("success_measure_entries", [
      { measure_id: "c1", week_ending: THIS_FRIDAY, value_number: 95, value_text: null },
    ]);
    const board = await getBoardData("co1", "America/Toronto");
    const row = board.functions[0].metrics.find((m) => m.kind === "csf");
    expect(row?.cells.at(-1)?.status).toBe("good");
    expect(row?.cells.at(-1)?.numericValue).toBe(95);
  });
});

describe("getBoardData — several CSFs in one function", () => {
  it("keeps each CSF with its own KPIs rather than interleaving them", async () => {
    seed("functions", [
      { id: "f1", title: "Ops", lead_id: null, parent_function_id: null, sort_order: 0 },
    ]);
    seed("profiles", []);
    seed(`success_measures::${CSF_COLS}`, [
      csf("c1", "On-time delivery", "f1", { sort_order: 0 }),
      csf("c2", "Rework rate", "f1", { sort_order: 1 }),
    ]);
    seed("csf_kpi_links", [
      { csf_id: "c1", kpi_id: "k1" },
      { csf_id: "c2", kpi_id: "k2" },
    ]);
    seed(`success_measures::${KPI_COLS}`, [
      kpi("k1", "Jobs scheduled a week out"),
      kpi("k2", "Inspections passed first time"),
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
});
