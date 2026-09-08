import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// getMeasuresPageData — one pass over the database for both /measures
// surfaces.
//
// THE REGRESSION BEING PINNED. The page used to call getMeasuresTree
// and getBoardData side by side. Each walked the same chain —
// functions, critical success factors, csf_kpi_links, the linked KPIs
// — so four of the five reads happened twice on every page load, and
// each chain was five round trips deep because every step needs the
// previous step's ids.
//
// Counting reads per table is the only way to catch that coming back.
// The shapes would stay correct if someone reintroduced the second
// loader; only the query count would move, and nothing else in the
// suite looks at it.

const FROZEN_NOW = new Date("2026-09-02T18:00:00Z"); // a Wednesday
const THIS_FRIDAY = "2026-09-04";

const mocks = vi.hoisted(() => {
  const rows = new Map<string, unknown[]>();
  const reads: string[] = [];
  return { rows, reads };
});

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: (table: string) => {
      mocks.reads.push(table);
      let key = table;
      const chain: Record<string, unknown> = {};
      const pass = () => chain;
      Object.assign(chain, {
        select: (cols: string) => {
          // success_measures is read twice with different column
          // lists — CSFs by function, then the linked KPIs by id — so
          // fixtures key on table plus select.
          key = `${table}::${cols}`;
          return chain;
        },
        eq: pass,
        in: pass,
        gte: pass,
        lte: pass,
        order: pass,
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({
            data: mocks.rows.get(key) ?? mocks.rows.get(table) ?? [],
          }).then(resolve),
      });
      return chain;
    },
  }),
}));

const CSF_COLS =
  "id, description, detail, target, value_type, target_direction, auto_track, update_frequency, target_hint, function_id, sort_order";
const KPI_COLS =
  "id, description, target, value_type, target_direction, auto_track, update_frequency, target_hint, sort_order";

function seedCompany() {
  mocks.rows.set("functions", [
    {
      id: "f_1",
      title: "Operations",
      sort_order: 0,
      parent_function_id: null,
      lead_id: "u_lead",
      track_id: null,
    },
  ]);
  mocks.rows.set("profiles", [{ id: "u_lead", full_name: "Dana Lead" }]);
  mocks.rows.set(`success_measures::${CSF_COLS}`, [
    {
      id: "csf_1",
      description: "On-time delivery",
      detail: null,
      target: "95",
      value_type: "percent",
      target_direction: "higher_is_better",
      auto_track: false,
      update_frequency: "weekly",
      target_hint: null,
      function_id: "f_1",
      sort_order: 0,
    },
  ]);
  mocks.rows.set("csf_kpi_links", [{ csf_id: "csf_1", kpi_id: "kpi_1" }]);
  mocks.rows.set(`success_measures::${KPI_COLS}`, [
    {
      id: "kpi_1",
      description: "Jobs shipped",
      target: "20",
      value_type: "number",
      target_direction: "higher_is_better",
      auto_track: true,
      update_frequency: "weekly",
      target_hint: null,
      sort_order: 0,
    },
  ]);
  mocks.rows.set("success_measure_entries", [
    { measure_id: "kpi_1", week_ending: THIS_FRIDAY, value_number: 22, value_text: null },
    { measure_id: "csf_1", week_ending: THIS_FRIDAY, value_number: 97, value_text: null },
  ]);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FROZEN_NOW);
  mocks.rows.clear();
  mocks.reads.length = 0;
  seedCompany();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getMeasuresPageData — reads happen once", () => {
  it("touches each table exactly once for both surfaces", async () => {
    const { getMeasuresPageData } = await import("./page-data");

    await getMeasuresPageData("co_1", "u_lead", "America/Anchorage", true);

    const counts = mocks.reads.reduce<Record<string, number>>((acc, t) => {
      acc[t] = (acc[t] ?? 0) + 1;
      return acc;
    }, {});

    expect(counts).toEqual({
      functions: 1,
      profiles: 1,
      // Twice, but for two different things: CSFs by function, then
      // the linked KPIs by id. Neither is a duplicate of the other.
      success_measures: 2,
      csf_kpi_links: 1,
      success_measure_entries: 1,
    });
    // Six reads total. Loading the two surfaces separately was eleven.
    expect(mocks.reads).toHaveLength(6);
  });

  it("still produces both shapes from that single pass", async () => {
    const { getMeasuresPageData } = await import("./page-data");

    const { tree, board } = await getMeasuresPageData(
      "co_1",
      "u_lead",
      "America/Anchorage",
      true
    );

    // The Manager tree: function → CSF → KPI, with this week's value.
    expect(tree.weekEnding).toBe(THIS_FRIDAY);
    expect(tree.functions).toHaveLength(1);
    expect(tree.functions[0].outcomes[0].title).toBe("On-time delivery");
    expect(tree.functions[0].outcomes[0].currentValue).toEqual({
      number: 97,
      text: null,
    });
    expect(tree.functions[0].outcomes[0].measures[0].description).toBe(
      "Jobs shipped"
    );

    // The Board: 13 columns, CSF row ahead of the KPI it heads.
    expect(board.weeks).toHaveLength(13);
    expect(board.currentWeekEnding).toBe(THIS_FRIDAY);
    expect(board.functions[0].metrics.map((m) => m.kind)).toEqual([
      "csf",
      "kpi",
    ]);
    expect(board.functions[0].seatHolder).toBe("Dana Lead");
  });

  it("bails after the first read when the company has no functions", async () => {
    // An empty company must not walk the rest of the chain. Cheap,
    // and it is the first-run state every new tenant starts in.
    mocks.rows.set("functions", []);
    const { getMeasuresPageData } = await import("./page-data");

    const { tree, board } = await getMeasuresPageData(
      "co_1",
      "u_1",
      "America/Anchorage",
      true
    );

    expect(tree.functions).toEqual([]);
    expect(board.functions).toEqual([]);
    expect(board.weeks).toHaveLength(13);
    // functions + profiles fire together; nothing downstream runs.
    expect(mocks.reads).toEqual(["functions", "profiles"]);
  });
});
