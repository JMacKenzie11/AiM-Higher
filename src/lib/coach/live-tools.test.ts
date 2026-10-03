import { describe, it, expect, vi, beforeEach } from "vitest";

// current_plan, open_issues, measures_now (2026-10-03, from Benson's
// "What are our goals?" in the panel).

const mocks = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  lastFilters: [] as string[][],
  cascade: vi.fn(),
  spine: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/instances/current", () => ({ getCurrentInstanceConfig: async () => ({ subdomain: "t" }) }));
vi.mock("@/lib/plan/service", () => ({ getCascade: mocks.cascade }));
vi.mock("@/lib/measures/spine", () => ({ loadMeasuresSpine: mocks.spine }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: (table: string) => {
      const applied: string[] = [`from:${table}`];
      mocks.lastFilters.push(applied);
      const chain: Record<string, unknown> = {};
      const note =
        (op: string) =>
        (...a: unknown[]) => {
          applied.push(`${op}:${String(a[0])}=${String(a[1])}`);
          return chain;
        };
      Object.assign(chain, {
        select: note("select"),
        eq: note("eq"),
        in: note("in"),
        is: note("is"),
        order: note("order"),
        limit: note("limit"),
        maybeSingle: () => Promise.resolve({ data: (mocks.tables[table] ?? [])[0] ?? null, error: null }),
        then: (r: (v: unknown) => unknown) => Promise.resolve({ data: mocks.tables[table] ?? [], error: null }).then(r),
      });
      return chain;
    },
  }),
}));

import { buildLiveTools } from "./live-tools";

const tool = (name: string) => buildLiveTools({ companyId: "co_1" }).find((t) => t.definition.name === name)!;

const prio = (title: string, extra: object = {}) => ({
  title,
  owner: { id: "p1", full_name: "Casey Moore" },
  status: "on_track",
  due_date: "2026-09-25",
  percent: 50,
  kept_count: 2,
  open_count: 1,
  missed_count: 0,
  carried_count: 0,
  ...extra,
});

beforeEach(() => {
  mocks.tables = { companies: [{ timezone: "America/Toronto" }] };
  mocks.lastFilters = [];
  mocks.cascade.mockReset();
  mocks.spine.mockReset();
});

describe("current_plan", () => {
  it("returns the open quarter's plan, flagged lapsed once its end date has passed", async () => {
    mocks.tables.quarters = [{ id: "q3", label: "Q3 2026", start_date: "2026-07-01", end_date: "2026-09-30" }];
    mocks.cascade.mockResolvedValue({
      sfas: [
        {
          title: "Grow processing",
          sponsor: { full_name: "Dana Kim" },
          status: "on_track",
          percent: 40,
          goals: [{ title: "Process 15M lbs", owner: null, status: "on_track", target_date: null, percent: 40, priorities: [prio("New line")] }],
          priorities: [prio("Hire a supervisor")],
        },
      ],
      orphanGoals: [],
      orphanPriorities: [prio("Fix the walk-in")],
    });
    const out = (await tool("current_plan").handler({})) as Record<string, any>;
    expect(out.status).toBe("ok");
    expect(mocks.cascade).toHaveBeenCalledWith("co_1", "q3");
    expect(out.quarter).toMatchObject({ label: "Q3 2026", lapsed: true });
    expect(out.focus_areas[0].goals[0].priorities[0]).toMatchObject({ title: "New line", owner: "Casey Moore", progress_pct: 50 });
    // A priority straight on a focus area is there too (0209).
    expect(out.focus_areas[0].priorities[0].title).toBe("Hire a supervisor");
    expect(out.priorities_without_goal[0].title).toBe("Fix the walk-in");
    const q = mocks.lastFilters.find((f) => f[0] === "from:quarters")!;
    expect(q).toContain("eq:company_id=co_1");
    expect(q).toContain("eq:status=open");
  });

  it("still gives the focus areas and goals when no quarter is open", async () => {
    mocks.cascade.mockResolvedValue({
      sfas: [{ title: "Grow", sponsor: null, status: "on_track", percent: null, goals: [], priorities: [] }],
      orphanGoals: [],
      orphanPriorities: [],
    });
    const out = (await tool("current_plan").handler({})) as Record<string, any>;
    expect(out.status).toBe("no_open_quarter");
    expect(mocks.cascade).toHaveBeenCalledWith("co_1", null);
    expect(out.focus_areas[0].title).toBe("Grow");
  });

  it("says empty when nothing is planned", async () => {
    mocks.cascade.mockResolvedValue({ sfas: [], orphanGoals: [], orphanPriorities: [] });
    expect(await tool("current_plan").handler({})).toMatchObject({ status: "empty" });
  });
});

describe("open_issues", () => {
  it("lists open issues in rank order with the commitments taken against each", async () => {
    mocks.tables.issues = [
      { id: "i1", title: "Walk-in freezer keeps failing", desired_outcome: "No lost product", rank: 1, created_at: "2026-09-01T12:00:00Z" },
    ];
    mocks.tables.commitments = [{ issue_id: "i1", description: "Call the repair company", status: "open", due_date: "2026-10-09", owner_id: "p1" }];
    mocks.tables.profiles = [{ id: "p1", full_name: "Casey Moore" }];
    const out = (await tool("open_issues").handler({})) as Record<string, any>;
    expect(out.status).toBe("ok");
    expect(out.issues[0]).toMatchObject({
      title: "Walk-in freezer keeps failing",
      wanted: "No lost product",
      raised: "2026-09-01",
      commitments_taken: 1,
      commitments: [{ description: "Call the repair company", owner: "Casey Moore", status: "open" }],
    });
    const q = mocks.lastFilters.find((f) => f[0] === "from:issues")!;
    expect(q).toContain("eq:company_id=co_1");
    expect(q).toContain("eq:status=open");
  });

  it("says empty when none are open", async () => {
    mocks.tables.issues = [];
    expect(await tool("open_issues").handler({})).toMatchObject({ status: "empty" });
  });
});

describe("measures_now", () => {
  const spine = {
    weekEnding: "2026-10-09",
    weeks: ["2026-09-11", "2026-09-18", "2026-09-25", "2026-10-02", "2026-10-09"],
    functions: [{ id: "f1", title: "Operations", lead_id: "p1", sort_order: 0 }],
    roster: [{ id: "p1", full_name: "Casey Moore" }],
    csfRows: [
      { id: "m1", description: "Pounds Processed", target: "250000", value_type: "number", value_scale: "thousands", target_direction: "higher_is_better", function_id: "f1", sort_order: 0 },
    ],
    // The target went up on 2026-10-01; each week is judged by the one in force then.
    targetRows: [
      { measure_id: "m1", target: "200000", value_type: "number", target_direction: "higher_is_better", effective_from: "2026-01-01" },
      { measure_id: "m1", target: "250000", value_type: "number", target_direction: "higher_is_better", effective_from: "2026-10-01" },
    ],
    entryRows: [
      { measure_id: "m1", week_ending: "2026-10-02", value_number: 240000, value_text: null },
      { measure_id: "m1", week_ending: "2026-09-25", value_number: 210000, value_text: null },
    ],
  };

  it("gives each measure's last four weeks, newest first, judged by the target in force that week", async () => {
    mocks.spine.mockResolvedValue(spine);
    const out = (await tool("measures_now").handler({})) as Record<string, any>;
    expect(mocks.spine).toHaveBeenCalledWith("co_1", "America/Toronto");
    const m = out.measures[0];
    expect(m).toMatchObject({ function: "Operations", function_lead: "Casey Moore", measure: "Pounds Processed", higher_is_better: true });
    expect(m.target).toMatch(/250/);
    expect(m.weeks.map((w: any) => w.week_ending)).toEqual(["2026-10-09", "2026-10-02", "2026-09-25", "2026-09-18"]);
    expect(m.weeks.map((w: any) => w.status)).toEqual(["unlogged", "off", "good", "unlogged"]);
    expect(m.weeks[1].value).toMatch(/240/);
  });

  it("says empty when there are no measures", async () => {
    mocks.spine.mockResolvedValue({ ...spine, csfRows: [] });
    expect(await tool("measures_now").handler({})).toMatchObject({ status: "empty" });
  });
});

describe("live tools read as the caller", () => {
  it("no service client, and no conversation or memory reads", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/lib/coach/live-tools.ts", "utf8").replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toMatch(/createSupabaseAdminClient/);
    expect(src).not.toMatch(/coaching_conversations|coaching_messages|coach_memories/);
  });

  it("take no identifiers from the model", () => {
    for (const t of buildLiveTools({ companyId: "co_1" })) {
      expect(Object.keys((t.definition.input_schema as { properties: object }).properties)).toEqual([]);
    }
  });
});
