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
const OLDEST = "2026-07-31"; // weekEnding - 35 days, the tree's trail
// weekEnding - 51 weeks: what the shared spine fetches. It was the
// board's 13, then the grid's 26; the spine takes the widest window
// any consumer wants and each narrows in memory.
const GRID_OLDEST = "2025-09-12";
// Still inside that window, outside the tree's five-week trail.
const BOARD_OLDEST = "2026-06-12";

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
  "id, description, detail, target, value_type, value_scale, target_direction, update_frequency, target_hint, function_id, sort_order, created_at, show_on_dashboard";

function seed(table: string, value: unknown[]) {
  mocks.rows.set(table, value);
}

function fn(
  id: string,
  title: string,
  sort_order = 0,
  parent_function_id: string | null = null,
  seats: { lead_id?: string | null; track_id?: string | null } = {}
) {
  return {
    id,
    title,
    sort_order,
    parent_function_id,
    lead_id: seats.lead_id ?? null,
    track_id: seats.track_id ?? null,
  };
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
    update_frequency: "weekly",
    target_hint: null,
    // Anchors the frequency rhythm. Old enough that every week in
    // the window is inside the measure's life, so a weekly row is
    // expected throughout and a monthly one lands on month ends.
    created_at: "2026-01-02T00:00:00Z",
    ...overrides,
  };
}

// A measure is a critical success factor. `parent` used to name the
// CSF it hung under; it now decides only where the row sorts, so a
// test written against the old model keeps describing the same list
// in the same order.
function measure(
  id: string,
  description: string,
  parent: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    id,
    description,
    detail: null,
    target: null,
    value_type: "number",
    target_direction: "higher_is_better",
    update_frequency: "weekly",
    target_hint: null,
    function_id: "f_1",
    sort_order: 0,
    __parent: parent,
    ...overrides,
  };
}

// Appends measures to the rows already seeded, placed after the row
// they used to hang under.
//
// 0216 renumbered sort_order exactly this way, so what the tree
// returns here is the order a real company sees. The second argument
// is ignored: it named the links, and there are none.
function seedMeasures(
  rows: Array<{ id: string } & Record<string, unknown>>,
  _linkPairs: Array<[string, string]> = []
) {
  const key = `success_measures::${CSF_COLS}`;
  const existing = (mocks.rows.get(key) ?? []) as Array<
    Record<string, unknown>
  >;
  const placed = rows.map((row) => {
    const { __parent, ...rest } = row as Record<string, unknown>;
    const parent = existing.find((e) => e.id === __parent);
    const base = ((parent?.sort_order as number) ?? 0) * 1000;
    const offset = rows.filter((r) => r.__parent === __parent).indexOf(row) + 1;
    return { ...rest, sort_order: base + offset };
  });
  const all = [
    ...existing.map((e) => ({
      ...e,
      sort_order: ((e.sort_order as number) ?? 0) * 1000,
    })),
    ...placed,
  ].sort((a, b) => (a.sort_order as number) - (b.sort_order as number));
  seed(key, all);
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

describe("getGridData — scoping", () => {
  it("returns an empty tree and no further queries when the company has no functions", async () => {
    seed("functions", []);
    const { getGridData } = await import("./grid");

    const result = await getGridData("co_1", "u_1", "America/Anchorage", true);

    expect(result.groups).toEqual([]);
    expect(result.hasRows).toBe(false);
    expect(result.currentWeekEnding).toBe(THIS_FRIDAY);
    // Bails before touching measures at all.
    expect(mocks.calls.some((c) => c.table === "success_measures")).toBe(false);
  });

  it("filters to the caller's own functions when includeAll is false", async () => {
    seed("functions", [fn("f_1", "Sales")]);
    seed(`success_measures::${CSF_COLS}`, []);
    const { getGridData } = await import("./grid");

    await getGridData("co_1", "u_leader", "America/Anchorage", false);

    // Nothing is filtered out any more. Everyone in the company
    // reads every function; what narrows is writing, and that is
    // `canLog` per function rather than a query filter.
    //
    // This assertion has now recorded three different rules. The
    // first pinned .eq("leader_id", …), which was a bug: that column
    // was renamed to `lead_id` in migration 0020, so it matched
    // nothing and every non-admin saw an empty page.
    const seatFilter = mocks.calls.find(
      (c) => c.table === "functions" && (c.op === "or" || c.args[0] === "lead_id")
    );
    expect(seatFilter).toBeUndefined();
  });

  it("marks only the caller's own seats as writable", async () => {
    // THE TRACK SEAT IS NOT A SEAT. `f_tracked` names this caller in
    // track_id and is not writable, which reverses what this test
    // asserted before. No form in the app submits track_id, so it is
    // null on every function written through it: fleet-wide there are
    // three rows with one, two of which differ from the lead. A
    // branch over a column nothing populates cannot be trusted, so it
    // came out rather than being carried forward into the Lead
    // authoring widening.
    seed("functions", [
      fn("f_mine", "Sales", 0, null, { lead_id: "u_leader" }),
      fn("f_tracked", "Ops", 1, null, { track_id: "u_leader" }),
      fn("f_theirs", "Finance", 2, null, { lead_id: "u_other" }),
    ]);
    seed(`success_measures::${CSF_COLS}`, []);
    const { getGridData } = await import("./grid");

    const { groups } = await getGridData(
      "co_1",
      "u_leader",
      "America/Anchorage",
      false
    );

    // Lead and Track both write, matching upsertMeasureEntryAction.
    // Everything else is readable and not writable.
    expect(
      Object.fromEntries(groups.map((g) => [g.functionTitle, g.canLog]))
    ).toEqual({ Sales: true, Ops: false, Finance: false });
  });

  it("gives every viewer the SAME order, seats or not", async () => {
    // This used to float the caller's own functions to the top, so a
    // Lead landed on their own row without scrolling. Good idea for a
    // page nobody could arrange; wrong one now the order is something
    // a person drags into place and expects to hold.
    //
    // Two people comparing the same page have to be looking at the
    // same page, and an order only some viewers see is not a saved
    // order. So sort_order decides it for everybody, and the leader
    // below sees their own Warehouse second, exactly as an admin does.
    seed("functions", [
      fn("f_a", "Admin", 0, null, { lead_id: "u_other" }),
      fn("f_z", "Warehouse", 1, null, { lead_id: "u_leader" }),
    ]);
    seed(`success_measures::${CSF_COLS}`, []);
    const { getGridData } = await import("./grid");

    const asLeader = await getGridData(
      "co_1",
      "u_leader",
      "America/Anchorage",
      false
    );
    const asAdmin = await getGridData(
      "co_1",
      "u_admin",
      "America/Anchorage",
      true
    );

    expect(asLeader.groups.map((g) => g.functionTitle)).toEqual([
      "Admin",
      "Warehouse",
    ]);
    expect(asAdmin.groups.map((g) => g.functionTitle)).toEqual(
      asLeader.groups.map((g) => g.functionTitle)
    );
    // And the seat still shows, which is what canLog is for — the
    // reshuffle was never how a Lead knew which rows were theirs.
    expect(
      Object.fromEntries(asLeader.groups.map((g) => [g.functionTitle, g.canLog]))
    ).toEqual({ Admin: false, Warehouse: true });
  });

  it("marks every function writable for an admin", async () => {
    seed("functions", [fn("f_1", "Sales", 0, null, { lead_id: "u_other" })]);
    seed(`success_measures::${CSF_COLS}`, []);
    const { getGridData } = await import("./grid");

    const { groups } = await getGridData(
      "co_1",
      "u_admin",
      "America/Anchorage",
      true
    );

    expect(groups[0].canLog).toBe(true);
  });

  it("does not filter by leader when includeAll is true", async () => {
    seed("functions", [fn("f_1", "Sales")]);
    seed(`success_measures::${CSF_COLS}`, []);
    const { getGridData } = await import("./grid");

    await getGridData("co_1", "u_admin", "America/Anchorage", true);

    const leaderFilter = mocks.calls.find(
      (c) => c.table === "functions" && c.op === "or"
    );
    expect(leaderFilter).toBeUndefined();
  });

  it("keeps functions that have no outcomes, so admins can author from scratch", async () => {
    seed("functions", [fn("f_1", "Sales"), fn("f_2", "Operations", 1)]);
    seed(`success_measures::${CSF_COLS}`, []);
    const { getGridData } = await import("./grid");

    const { groups } = await getGridData("co_1", "u_1", "America/Anchorage", true);

    expect(groups.map((g) => g.functionId)).toEqual(["f_1", "f_2"]);
    expect(groups[0].rows).toEqual([]);
  });
});

describe("getGridData — function ordering", () => {
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
    const { getGridData } = await import("./grid");

    const { groups } = await getGridData("co_1", "u_1", "America/Anchorage", true);

    expect(groups.map((g) => g.functionTitle)).toEqual([
      "Visionary",
      "Integrator",
      "Sales",
      "Operations",
    ]);
  });

  it("orders a leader's view by hierarchy too, not alphabetically", async () => {
    // The alphabetical fallback existed because a leader saw a
    // partial tree that could not be walked. There are no partial
    // trees any more, so hierarchy order applies to everyone; a
    // leader's own seats are simply hoisted to the front.
    seed("functions", [
      fn("f_vis", "Visionary", 0, null),
      fn("f_z", "Warehouse", 1, "f_vis"),
      fn("f_a", "Assembly", 2, "f_vis"),
    ]);
    seed(`success_measures::${CSF_COLS}`, []);
    const { getGridData } = await import("./grid");

    const { groups } = await getGridData("co_1", "u_1", "America/Anchorage", false);

    expect(groups.map((g) => g.functionTitle)).toEqual([
      "Visionary",
      "Warehouse",
      "Assembly",
    ]);
  });

  it("never drops a function whose parent is missing from the set", async () => {
    // A broken parent pointer must not silently remove a seat from the
    // page. Orphans are appended rather than lost.
    seed("functions", [
      fn("f_vis", "Visionary", 0, null),
      fn("f_orphan", "Detached", 1, "f_not_here"),
    ]);
    seed(`success_measures::${CSF_COLS}`, []);
    const { getGridData } = await import("./grid");

    const { groups } = await getGridData("co_1", "u_1", "America/Anchorage", true);

    expect(groups.map((g) => g.functionId)).toContain("f_orphan");
    expect(groups).toHaveLength(2);
  });
});

// ---- What it READS ---------------------------------------------
//
// The shaping is grid.test.ts's, against fixed rows and no database.
// What only this file can see is the queries: how wide the entry
// window is, and whose clock decides the week.
describe("getGridData — the reads", () => {
  beforeEach(() => {
    seed("functions", [fn("f_1", "Sales")]);
    seed(`success_measures::${CSF_COLS}`, [outcome("o_1", "Revenue", "f_1")]);
  });

  it("fetches the grid's rolling year, since every surface shares one read", async () => {
    // The entries read was five weeks, matching the old tree's trail,
    // then 13 for the board, then 26 for the grid. It is the widest
    // window any consumer takes, because fetching a narrower one
    // would mean a second query for rows already in memory. Each
    // consumer narrows in shaping instead: the board to 13 weeks.
    //
    // A year, not six months: six shows a season, twelve shows the
    // same season last year, which is the comparison these numbers
    // are read for.
    seed("success_measure_entries", []);
    const { getGridData } = await import("./grid");
    await getGridData("co_1", "u_1", "America/Anchorage", true);

    const gte = mocks.calls.find(
      (c) => c.table === "success_measure_entries" && c.op === "gte"
    );
    const lte = mocks.calls.find(
      (c) => c.table === "success_measure_entries" && c.op === "lte"
    );
    expect(gte?.args).toEqual(["week_ending", GRID_OLDEST]);
    expect(lte?.args).toEqual(["week_ending", THIS_FRIDAY]);
  });

  it("reads target history for the measures it found", async () => {
    // Without it every cell is judged against the CURRENT target and
    // 0215 buys nothing. The read is unbounded by date on purpose:
    // the row in force for the oldest week on screen is usually older
    // than that week.
    seed("success_measure_entries", []);
    const { getGridData } = await import("./grid");
    await getGridData("co_1", "u_1", "America/Anchorage", true);

    const call = mocks.calls.find(
      (c) => c.table === "success_measure_targets" && c.op === "in"
    );
    expect(call?.args?.[0]).toBe("measure_id");
    expect(mocks.calls.some(
      (c) => c.table === "success_measure_targets" && (c.op === "gte" || c.op === "lte")
    )).toBe(false);
  });

  it("computes the week in the company's timezone", async () => {
    seed("success_measure_entries", []);
    const { getGridData } = await import("./grid");

    const { currentWeekEnding } = await getGridData(
      "co_1",
      "u_1",
      "America/Anchorage",
      true
    );

    expect(currentWeekEnding).toBe(THIS_FRIDAY);
  });
});
