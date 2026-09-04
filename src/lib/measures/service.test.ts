import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// CHARACTERISATION TESTS for getMeasuresTree.
//
// Phase 1 of the CSF/KPI migration. This loader builds the entire
// /measures surface: function → outcome → measure, with each measure
// carrying its current week's value and a five-week trail. The
// refactor turns outcomes into CSF measures and measures into KPIs,
// which means every shaping rule below gets rewritten around a
// different query.
//
// These tests pin what the loader produces TODAY against fixed rows.
// They are not a specification of what the tree should contain; they
// record what it does contain, so a change during the refactor shows
// up as a diff to explain rather than a test to quietly update.
//
// Ordering is the fragile part and most of what is pinned here.
// Functions come back in depth-first pre-order with Visionary pinned
// first and Integrator second, but only for admins — leaders get
// alphabetical, because a partial tree can't be walked meaningfully.
// Outcomes sort by sort_order then title. Measures keep the order the
// query returned. All four of those rules are easy to lose in a
// rewrite and invisible when lost.

const FROZEN_NOW = new Date("2026-09-02T18:00:00Z"); // a Wednesday
const THIS_FRIDAY = "2026-09-04";
const OLDEST = "2026-07-31"; // weekEnding - 35 days

const mocks = vi.hoisted(() => {
  // Rows keyed by table name. The fake ignores filters and returns
  // the fixture, so each fixture is pre-filtered to what that query
  // would have returned. Re-implementing PostgREST in a stub would
  // only test the stub.
  const rows = new Map<string, unknown[]>();
  // Records the arguments the loader filtered on, so the tests can
  // assert the window and the leader scoping without inspecting SQL.
  const calls: Array<{ table: string; op: string; args: unknown[] }> = [];
  return { rows, calls };
});

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => {
    const make = (table: string) => {
      let key = table;
      const chain: Record<string, unknown> = {};
      const record = (op: string) => (...args: unknown[]) => {
        mocks.calls.push({ table, op, args });
        return chain;
      };
      Object.assign(chain, {
        // getMeasuresTree hits success_measures twice with different
        // column lists — once for CSFs, once for the linked KPIs — so
        // the fixture key includes the select string.
        select: (cols: string) => {
          key = `${table}::${cols}`;
          mocks.calls.push({ table, op: "select", args: [cols] });
          return chain;
        },
        eq: record("eq"),
        or: record("or"),
        neq: record("neq"),
        in: record("in"),
        is: record("is"),
        gte: record("gte"),
        lte: record("lte"),
        order: record("order"),
        limit: record("limit"),
        maybeSingle: async () => ({
          data: (mocks.rows.get(key) ?? mocks.rows.get(table) ?? [])[0] ?? null,
        }),
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

// Column lists the loader uses, so fixtures can be keyed exactly.
const CSF_COLS =
  "id, description, detail, target, value_type, target_direction, auto_track, update_frequency, target_hint, function_id, sort_order";
const KPI_COLS =
  "id, description, target, value_type, target_direction, auto_track, update_frequency, target_hint, sort_order";

function seed(table: string, value: unknown[]) {
  mocks.rows.set(table, value);
}

function fn(
  id: string,
  title: string,
  sort_order = 0,
  parent_function_id: string | null = null
) {
  return { id, title, sort_order, parent_function_id };
}

// An outcome IS a CSF measure now. title maps to the measure's
// `description` (the field holding a measure's name) and the
// outcome's own description maps to `detail`.
function outcome(
  id: string,
  title: string,
  function_id: string,
  sort_order = 0,
  description: string | null = null,
  overrides: Record<string, unknown> = {}
) {
  return {
    id,
    description: title,
    detail: description,
    function_id,
    sort_order,
    // A CSF is measured now (phase 4). Defaults mirror the column
    // defaults; target stays null because an untargeted CSF is a
    // normal state, not a failure.
    target: null,
    value_type: "number",
    target_direction: "higher_is_better",
    auto_track: false,
    update_frequency: "weekly",
    target_hint: null,
    ...overrides,
  };
}

// A measure is a KPI, reached through csf_kpi_links rather than a
// parent column. seedMeasures below writes both the rows and links.
function measure(
  id: string,
  description: string,
  _outcome_id: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    id,
    description,
    target: null,
    value_type: "number",
    target_direction: "higher_is_better",
    auto_track: true,
    update_frequency: "weekly",
    target_hint: null,
    sort_order: 0,
    ...overrides,
  };
}

// Seeds KPI rows and the links that attach them to their CSF, so a
// test writes one call instead of remembering two tables.
function seedMeasures(
  rows: Array<{ id: string } & Record<string, unknown>>,
  linkPairs: Array<[string, string]>
) {
  seed(`success_measures::${KPI_COLS}`, rows);
  seed(
    "csf_kpi_links",
    linkPairs.map(([csf_id, kpi_id]) => ({ csf_id, kpi_id }))
  );
}

function entry(
  measure_id: string,
  week_ending: string,
  value_number: number | null,
  value_text: string | null = null
) {
  return { measure_id, week_ending, value_number, value_text };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(FROZEN_NOW);
  mocks.rows.clear();
  mocks.calls.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getMeasuresTree — scoping", () => {
  it("returns an empty tree and no further queries when the company has no functions", async () => {
    seed("functions", []);
    const { getMeasuresTree } = await import("./service");

    const result = await getMeasuresTree("co_1", "u_1", "America/Anchorage", true);

    expect(result).toEqual({ functions: [], weekEnding: THIS_FRIDAY });
    // Bails before touching measures at all.
    expect(mocks.calls.some((c) => c.table === "success_measures")).toBe(false);
  });

  it("filters to the caller's own functions when includeAll is false", async () => {
    seed("functions", [fn("f_1", "Sales")]);
    seed(`success_measures::${CSF_COLS}`, []);
    const { getMeasuresTree } = await import("./service");

    await getMeasuresTree("co_1", "u_leader", "America/Anchorage", false);

    // Was pinned to .eq("leader_id", ...) — which recorded a bug
    // rather than a rule. `functions.leader_id` was renamed to
    // `lead_id` in migration 0020, so that filter had matched nothing
    // for as long as it existed and every non-admin saw an empty
    // page. The scope is Lead OR Track, matching exactly who
    // upsertMeasureEntryAction lets write a value.
    const leaderFilter = mocks.calls.find(
      (c) => c.table === "functions" && c.op === "or"
    );
    expect(leaderFilter?.args[0]).toBe(
      "lead_id.eq.u_leader,track_id.eq.u_leader"
    );
  });

  it("does not filter by leader when includeAll is true", async () => {
    seed("functions", [fn("f_1", "Sales")]);
    seed(`success_measures::${CSF_COLS}`, []);
    const { getMeasuresTree } = await import("./service");

    await getMeasuresTree("co_1", "u_admin", "America/Anchorage", true);

    const leaderFilter = mocks.calls.find(
      (c) => c.table === "functions" && c.op === "or"
    );
    expect(leaderFilter).toBeUndefined();
  });

  it("keeps functions that have no outcomes, so admins can author from scratch", async () => {
    seed("functions", [fn("f_1", "Sales"), fn("f_2", "Operations", 1)]);
    seed(`success_measures::${CSF_COLS}`, []);
    const { getMeasuresTree } = await import("./service");

    const { functions } = await getMeasuresTree("co_1", "u_1", "America/Anchorage", true);

    expect(functions.map((f) => f.id)).toEqual(["f_1", "f_2"]);
    expect(functions[0].outcomes).toEqual([]);
  });
});

describe("getMeasuresTree — function ordering", () => {
  it("pins Visionary first and Integrator second, then walks depth-first", async () => {
    // Deliberately seeded out of order. Sales sorts before Operations
    // by sort_order, and each child follows its own parent rather than
    // all top-level functions listing first.
    seed("functions", [
      fn("f_ops", "Operations", 2, "f_int"),
      fn("f_int", "Integrator", 5, "f_vis"),
      fn("f_sales", "Sales", 1, "f_int"),
      fn("f_vis", "Visionary", 9, null),
    ]);
    seed(`success_measures::${CSF_COLS}`, []);
    const { getMeasuresTree } = await import("./service");

    const { functions } = await getMeasuresTree("co_1", "u_1", "America/Anchorage", true);

    expect(functions.map((f) => f.title)).toEqual([
      "Visionary",
      "Integrator",
      "Sales",
      "Operations",
    ]);
  });

  it("falls back to alphabetical for a leader, who only sees part of the tree", async () => {
    // A leader's functions can't be walked as a hierarchy because the
    // parents are missing from the set, so hierarchy ordering would
    // produce something arbitrary.
    seed("functions", [
      fn("f_z", "Warehouse", 1, "f_missing"),
      fn("f_a", "Assembly", 2, "f_missing"),
    ]);
    seed(`success_measures::${CSF_COLS}`, []);
    const { getMeasuresTree } = await import("./service");

    const { functions } = await getMeasuresTree("co_1", "u_1", "America/Anchorage", false);

    expect(functions.map((f) => f.title)).toEqual(["Assembly", "Warehouse"]);
  });

  it("never drops a function whose parent is missing from the set", async () => {
    // A broken parent pointer must not silently remove a seat from the
    // page. Orphans are appended rather than lost.
    seed("functions", [
      fn("f_vis", "Visionary", 0, null),
      fn("f_orphan", "Detached", 1, "f_not_here"),
    ]);
    seed(`success_measures::${CSF_COLS}`, []);
    const { getMeasuresTree } = await import("./service");

    const { functions } = await getMeasuresTree("co_1", "u_1", "America/Anchorage", true);

    expect(functions.map((f) => f.id)).toContain("f_orphan");
    expect(functions).toHaveLength(2);
  });
});

describe("getMeasuresTree — outcome and measure shaping", () => {
  beforeEach(() => {
    seed("functions", [fn("f_1", "Sales")]);
  });

  it("sorts outcomes by sort_order, then by title as the tiebreak", async () => {
    seed(`success_measures::${CSF_COLS}`, [
      outcome("o_b", "Beta", "f_1", 2),
      outcome("o_z", "Zulu", "f_1", 1),
      outcome("o_a", "Alpha", "f_1", 1),
    ]);
    seedMeasures([], []);
    const { getMeasuresTree } = await import("./service");

    const { functions } = await getMeasuresTree("co_1", "u_1", "America/Anchorage", true);

    expect(functions[0].outcomes.map((o) => o.title)).toEqual([
      "Alpha",
      "Zulu",
      "Beta",
    ]);
  });

  it("nests measures under their outcome and leaves outcomes with none empty", async () => {
    seed(`success_measures::${CSF_COLS}`, [
      outcome("o_1", "Revenue", "f_1", 0),
      outcome("o_2", "Retention", "f_1", 1),
    ]);
    seedMeasures(
      [measure("m_1", "Closed won", "o_1"), measure("m_2", "Pipeline", "o_1")],
      [
        ["o_1", "m_1"],
        ["o_1", "m_2"],
      ]
    );
    seed("success_measure_entries", []);
    const { getMeasuresTree } = await import("./service");

    const { functions } = await getMeasuresTree("co_1", "u_1", "America/Anchorage", true);

    expect(functions[0].outcomes[0].measures.map((m) => m.id)).toEqual([
      "m_1",
      "m_2",
    ]);
    expect(functions[0].outcomes[1].measures).toEqual([]);
  });

  it("carries every authoring field through to the shaped measure", async () => {
    seed(`success_measures::${CSF_COLS}`, [outcome("o_1", "Revenue", "f_1")]);
    seedMeasures(
      [
        measure("m_1", "Closed won", "o_1", {
          target: "100",
          value_type: "percent",
          target_direction: "lower_is_better",
          auto_track: false,
          target_hint: "Consider a time bound",
        }),
      ],
      [["o_1", "m_1"]]
    );
    seed("success_measure_entries", []);
    const { getMeasuresTree } = await import("./service");

    const { functions } = await getMeasuresTree("co_1", "u_1", "America/Anchorage", true);

    expect(functions[0].outcomes[0].measures[0]).toEqual({
      id: "m_1",
      description: "Closed won",
      target: "100",
      value_type: "percent",
      target_direction: "lower_is_better",
      auto_track: false,
      update_frequency: "weekly",
      target_hint: "Consider a time bound",
      currentValue: null,
      recent: [],
    });
  });
});

describe("getMeasuresTree — values and the five-week trail", () => {
  beforeEach(() => {
    seed("functions", [fn("f_1", "Sales")]);
    seed(`success_measures::${CSF_COLS}`, [outcome("o_1", "Revenue", "f_1")]);
    seedMeasures([measure("m_1", "Closed won", "o_1")], [["o_1", "m_1"]]);
  });

  it("sets currentValue only from an entry dated exactly this Friday", async () => {
    seed("success_measure_entries", [
      entry("m_1", THIS_FRIDAY, 42),
      entry("m_1", "2026-08-28", 30),
    ]);
    const { getMeasuresTree } = await import("./service");

    const { functions } = await getMeasuresTree("co_1", "u_1", "America/Anchorage", true);
    const m = functions[0].outcomes[0].measures[0];

    expect(m.currentValue).toEqual({ number: 42, text: null });
    expect(m.recent).toHaveLength(2);
  });

  it("leaves currentValue null when the latest entry predates this week", async () => {
    // A stale value must not read as this week's number.
    seed("success_measure_entries", [entry("m_1", "2026-08-28", 30)]);
    const { getMeasuresTree } = await import("./service");

    const { functions } = await getMeasuresTree("co_1", "u_1", "America/Anchorage", true);

    expect(functions[0].outcomes[0].measures[0].currentValue).toBeNull();
  });

  it("carries text values as well as numbers", async () => {
    seed("success_measure_entries", [entry("m_1", THIS_FRIDAY, null, "On track")]);
    const { getMeasuresTree } = await import("./service");

    const { functions } = await getMeasuresTree("co_1", "u_1", "America/Anchorage", true);

    expect(functions[0].outcomes[0].measures[0].currentValue).toEqual({
      number: null,
      text: "On track",
    });
  });

  it("requests a five-week window ending this Friday", async () => {
    seed("success_measure_entries", []);
    const { getMeasuresTree } = await import("./service");

    await getMeasuresTree("co_1", "u_1", "America/Anchorage", true);

    const gte = mocks.calls.find(
      (c) => c.table === "success_measure_entries" && c.op === "gte"
    );
    const lte = mocks.calls.find(
      (c) => c.table === "success_measure_entries" && c.op === "lte"
    );
    expect(gte?.args).toEqual(["week_ending", OLDEST]);
    expect(lte?.args).toEqual(["week_ending", THIS_FRIDAY]);
  });

  it("computes weekEnding in the company's timezone", async () => {
    seed("success_measure_entries", []);
    const { getMeasuresTree } = await import("./service");

    const { weekEnding } = await getMeasuresTree(
      "co_1",
      "u_1",
      "America/Anchorage",
      true
    );

    expect(weekEnding).toBe(THIS_FRIDAY);
  });
});

describe("getMeasuresTree — CSFs are measured (phase 4)", () => {
  beforeEach(() => {
    seed("functions", [fn("f_1", "Sales")]);
  });

  it("carries a CSF's own target, value and trail", async () => {
    seed(`success_measures::${CSF_COLS}`, [
      outcome("csf_1", "On-time delivery", "f_1", 0, "Why it matters", {
        target: "95",
        value_type: "percent",
        target_direction: "higher_is_better",
      }),
    ]);
    seedMeasures([], []);
    seed("success_measure_entries", [
      entry("csf_1", THIS_FRIDAY, 94),
      entry("csf_1", "2026-08-28", 91),
    ]);
    const { getMeasuresTree } = await import("./service");

    const { functions } = await getMeasuresTree("co_1", "u_1", "America/Anchorage", true);
    const csf = functions[0].outcomes[0];

    expect(csf.title).toBe("On-time delivery");
    expect(csf.description).toBe("Why it matters");
    expect(csf.target).toBe("95");
    expect(csf.value_type).toBe("percent");
    expect(csf.currentValue).toEqual({ number: 94, text: null });
    expect(csf.recent).toHaveLength(2);
  });

  it("leaves a CSF with no target null rather than treating it as a miss", async () => {
    // Decided 2026-09-04: targets are optional on CSFs. A company may
    // name them and set targets later, so this is a normal state and
    // anything rendering it must say "no target", never "off target".
    seed(`success_measures::${CSF_COLS}`, [
      outcome("csf_1", "On-time delivery", "f_1"),
    ]);
    seedMeasures([], []);
    seed("success_measure_entries", [entry("csf_1", THIS_FRIDAY, 94)]);
    const { getMeasuresTree } = await import("./service");

    const { functions } = await getMeasuresTree("co_1", "u_1", "America/Anchorage", true);

    expect(functions[0].outcomes[0].target).toBeNull();
    expect(functions[0].outcomes[0].currentValue).toEqual({
      number: 94,
      text: null,
    });
  });

  it("keeps a CSF's values separate from its KPIs'", async () => {
    seed(`success_measures::${CSF_COLS}`, [
      outcome("csf_1", "On-time delivery", "f_1"),
    ]);
    seedMeasures([measure("kpi_1", "Schedule confirmed", "csf_1")], [
      ["csf_1", "kpi_1"],
    ]);
    seed("success_measure_entries", [
      entry("csf_1", THIS_FRIDAY, 94),
      entry("kpi_1", THIS_FRIDAY, 5),
    ]);
    const { getMeasuresTree } = await import("./service");

    const { functions } = await getMeasuresTree("co_1", "u_1", "America/Anchorage", true);
    const csf = functions[0].outcomes[0];

    expect(csf.currentValue?.number).toBe(94);
    expect(csf.measures[0].currentValue?.number).toBe(5);
  });
});
