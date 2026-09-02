import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// CHARACTERISATION TESTS for getDashboardData.
//
// Purpose: this loader runs 13 queries in a straight line and is about
// to be reshaped into parallel waves. The derivation logic (maps,
// reductions, sorts) is interleaved between the awaits, so
// parallelising means separating fetching from deriving — and that
// reshuffle is exactly where a subtle bug would land. A wrong
// keep-rate is the kind of error nobody notices for weeks and then
// nobody trusts afterwards.
//
// These tests therefore pin the CURRENT output byte-for-byte against
// a fixed set of rows. They are not a specification of what the
// numbers should be; they are a record of what they are. If the
// refactor changes any of them, that is a regression to explain, not
// a test to update.
//
// Two things make the output deterministic:
//   1. The clock is frozen. thisFriday() reads the real date, so the
//      12-week trend window would otherwise move daily.
//   2. The fake Supabase client routes on (table + select string).
//      Every query in this loader has a unique pair except the two
//      profiles id→full_name lookups (SFA sponsors and recent-success
//      owners), which are both satisfied by the same roster fixture.

// ---- Frozen clock --------------------------------------------
// 2026-09-02 is a Wednesday; the company timezone below is
// America/Anchorage (UTC-8 in September). Local Wednesday →
// thisFriday() = 2026-09-04, and the trend window runs back 11 weeks
// to 2026-06-19.
const FROZEN_NOW = new Date("2026-09-02T18:00:00Z");
const THIS_FRIDAY = "2026-09-04";
const OLDEST_TREND_WEEK = "2026-06-19";

const QUARTER = {
  id: "q_1",
  company_id: "co_1",
  label: "Q3 2026",
  start_date: "2026-07-01",
  end_date: "2026-09-30",
  status: "open",
};

// ---- Fixtures ------------------------------------------------
// Chosen to exercise the branches that matter: an SFA with a sponsor
// and one without, an SFA with no progress row (null percent), a
// clarity mix including unassessed rows, an unassigned commitment,
// and a recent success with no owner and no priority.
const ROSTER = [
  { id: "p_ana", full_name: "Ana Ruiz", position: "COO", reports_to: null },
  { id: "p_ben", full_name: "Ben Osei", position: "Ops Lead", reports_to: "p_ana" },
  { id: "p_cara", full_name: "Cara Lind", position: null, reports_to: "p_ana" },
];

const mocks = vi.hoisted(() => {
  const getCurrentQuarter = vi.fn();
  // Rows keyed by "table::select". Tests can override per case.
  const rows = new Map<string, unknown[]>();
  return { getCurrentQuarter, rows };
});

vi.mock("@/lib/quarters/service", () => ({
  getCurrentQuarter: mocks.getCurrentQuarter,
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => makeFakeClient(),
}));

// A chainable stub that ignores filters and resolves to whatever the
// fixture map holds for (table, select). Filters are deliberately NOT
// applied: the point is to pin the loader's DERIVATION, and applying
// them here would just re-implement PostgREST badly. Each fixture is
// therefore pre-filtered to what that specific query would return.
function makeFakeClient() {
  const builder = (table: string) => ({
    select(sel: string) {
      const key = `${table}::${sel}`;
      const data = mocks.rows.get(key) ?? [];
      const result = { data, error: null };
      const chain: Record<string, unknown> = {
        // Every filter/order/limit returns the same chain so any call
        // sequence works.
        eq: () => chain,
        neq: () => chain,
        in: () => chain,
        is: () => chain,
        gte: () => chain,
        lte: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: data[0] ?? null, error: null }),
        single: async () => ({ data: data[0] ?? null, error: null }),
        // Awaiting the chain itself resolves to the row list.
        then: (res: (v: unknown) => unknown) => Promise.resolve(result).then(res),
      };
      return chain;
    },
  });
  return { from: builder } as never;
}

function seed(key: string, value: unknown[]) {
  mocks.rows.set(key, value);
}

function seedHappyPath() {
  mocks.rows.clear();
  mocks.getCurrentQuarter.mockResolvedValue(QUARTER);

  seed("companies::id, name, timezone", [
    { id: "co_1", name: "Meridian Construction", timezone: "America/Anchorage" },
  ]);

  seed("strategic_focus_areas::*", [
    {
      id: "sfa_1",
      company_id: "co_1",
      title: "Win the north market",
      sponsor_id: "p_ana",
      sort_order: 1,
      archived: false,
      created_at: "2026-01-01",
    },
    {
      id: "sfa_2",
      company_id: "co_1",
      title: "Tighten operations",
      sponsor_id: null,
      sort_order: 2,
      archived: false,
      created_at: "2026-01-02",
    },
    {
      // No sfa_progress row → percent stays null and is excluded
      // from the execution mean.
      id: "sfa_3",
      company_id: "co_1",
      title: "Build the bench",
      sponsor_id: "p_missing",
      sort_order: 3,
      archived: false,
      created_at: "2026-01-03",
    },
  ]);

  // Doubles as the sponsor lookup AND the recent-success owner lookup.
  seed(
    "profiles::id, full_name",
    ROSTER.map((p) => ({ id: p.id, full_name: p.full_name }))
  );
  seed("profiles::id, full_name, position, reports_to", ROSTER);

  seed("sfa_progress::sfa_id, percent", [
    { sfa_id: "sfa_1", percent: 80 },
    { sfa_id: "sfa_2", percent: 45 },
  ]);

  seed("annual_goals::id", [{ id: "g_1" }, { id: "g_2" }]);

  seed("priorities::id, status, archived", [
    { id: "pr_1", status: "on_track", archived: false },
    { id: "pr_2", status: "complete", archived: false },
    { id: "pr_3", status: "at_risk", archived: false },
    { id: "pr_4", status: "off_track", archived: false },
  ]);

  // Quarter commitments: drives keep-rate, clarity, and per-person.
  seed("commitments::status, owner_id, clarity_timeline, clarity_success", [
    { status: "kept_on_time", owner_id: "p_ana", clarity_timeline: true, clarity_success: true },
    { status: "kept_on_time", owner_id: "p_ana", clarity_timeline: true, clarity_success: false },
    { status: "kept_late", owner_id: "p_ben", clarity_timeline: false, clarity_success: true },
    { status: "missed", owner_id: "p_ben", clarity_timeline: null, clarity_success: true },
    { status: "open", owner_id: "p_cara", clarity_timeline: true, clarity_success: true },
    // Unassigned: counts toward company keep-rate, no person row.
    { status: "missed", owner_id: null, clarity_timeline: null, clarity_success: null },
  ]);

  seed("commitments::id", [{ id: "c_1" }, { id: "c_2" }]);

  seed("commitments::week_ending, status", [
    { week_ending: THIS_FRIDAY, status: "kept_on_time" },
    { week_ending: THIS_FRIDAY, status: "missed" },
    { week_ending: "2026-08-28", status: "kept_on_time" },
    { week_ending: "2026-08-28", status: "kept_on_time" },
  ]);

  seed("commitments::owner_id", [
    { owner_id: "p_ana" },
    { owner_id: "p_cara" },
    { owner_id: "p_cara" },
    { owner_id: null },
  ]);

  seed(
    "commitments::id, description, week_ending, owner_id, priority_id, completed_at",
    [
      {
        id: "c_win",
        description: "Signed the Fairbanks contract",
        week_ending: "2026-08-28",
        owner_id: "p_ana",
        priority_id: "pr_1",
        completed_at: "2026-08-27T10:00:00Z",
      },
      {
        id: "c_win2",
        description: "Cleared the permit backlog",
        week_ending: "2026-08-21",
        owner_id: null,
        priority_id: null,
        completed_at: null,
      },
    ]
  );

  seed("priorities::id, title", [{ id: "pr_1", title: "Northern expansion" }]);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(FROZEN_NOW);
  seedHappyPath();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getDashboardData — company + quarter", () => {
  it("returns null when the company row is missing", async () => {
    seed("companies::id, name, timezone", []);
    const { getDashboardData } = await import("./service");

    expect(await getDashboardData("co_1")).toBeNull();
  });

  it("passes the company row and open quarter straight through", async () => {
    const { getDashboardData } = await import("./service");

    const data = (await getDashboardData("co_1"))!;

    expect(data.company).toEqual({
      id: "co_1",
      name: "Meridian Construction",
      timezone: "America/Anchorage",
    });
    expect(data.openQuarter).toEqual(QUARTER);
  });
});

describe("getDashboardData — focus areas and execution", () => {
  it("joins percent and sponsor onto each focus area, preserving order", async () => {
    const { getDashboardData } = await import("./service");

    const data = (await getDashboardData("co_1"))!;

    expect(data.sfas.map((s) => s.id)).toEqual(["sfa_1", "sfa_2", "sfa_3"]);
    expect(data.sfas[0].percent).toBe(80);
    expect(data.sfas[0].sponsor).toEqual({ id: "p_ana", full_name: "Ana Ruiz" });
    // sponsor_id null → sponsor null
    expect(data.sfas[1].sponsor).toBeNull();
    expect(data.sfas[1].percent).toBe(45);
    // No progress row → null percent. Sponsor id that isn't in the
    // roster → null rather than a crash.
    expect(data.sfas[2].percent).toBeNull();
    expect(data.sfas[2].sponsor).toBeNull();
  });

  it("averages only the non-null percents for execution", async () => {
    // (80 + 45) / 2 = 62.5 → rounds to 63. sfa_3's null is excluded
    // from BOTH numerator and denominator.
    const { getDashboardData } = await import("./service");

    const data = (await getDashboardData("co_1"))!;

    expect(data.headline.executionPercent).toBe(63);
  });

  it("reports a null execution percent when no focus area has progress", async () => {
    seed("sfa_progress::sfa_id, percent", []);
    const { getDashboardData } = await import("./service");

    const data = (await getDashboardData("co_1"))!;

    expect(data.headline.executionPercent).toBeNull();
  });

  it("counts orphan goals", async () => {
    const { getDashboardData } = await import("./service");

    expect((await getDashboardData("co_1"))!.orphanGoalCount).toBe(2);
  });
});

describe("getDashboardData — headline numbers", () => {
  it("counts on-track as on_track plus complete", async () => {
    const { getDashboardData } = await import("./service");

    const data = (await getDashboardData("co_1"))!;

    expect(data.headline.onTrack).toEqual({ good: 2, total: 4 });
  });

  it("computes keep-rate over the quarter, counting the unassigned row", async () => {
    // Resolved rows: 2 kept_on_time, 1 kept_late, 2 missed (one of
    // them unassigned). The open row is not resolved and does not
    // count. Follow-through is on-time only: 2 of 5 = 40%.
    const { getDashboardData } = await import("./service");

    const data = (await getDashboardData("co_1"))!;

    expect(data.headline.keepRatePercent).toBe(40);
  });

  it("excludes unassessed rows from clarity, not just from the numerator", async () => {
    // Assessed = BOTH booleans non-null, regardless of status — the
    // open row counts too, which is deliberate (the header comment
    // says "any status"). Fixture: rows 1, 2, 3 and 5 are assessed;
    // rows 4 and 6 have a null and drop out of numerator AND
    // denominator. All-clear = rows 1 and 5. So 2/4 = 50%, over a
    // total of 6 commitments in the quarter.
    const { getDashboardData } = await import("./service");

    const data = (await getDashboardData("co_1"))!;

    expect(data.headline.clarityAssessedCount).toBe(4);
    expect(data.headline.clarityTotalCount).toBe(6);
    expect(data.headline.clarityPercent).toBe(50);
  });

  it("reports null clarity when nothing has been assessed", async () => {
    seed("commitments::status, owner_id, clarity_timeline, clarity_success", [
      { status: "open", owner_id: "p_ana", clarity_timeline: null, clarity_success: null },
    ]);
    const { getDashboardData } = await import("./service");

    const data = (await getDashboardData("co_1"))!;

    expect(data.headline.clarityPercent).toBeNull();
    expect(data.headline.clarityAssessedCount).toBe(0);
  });

  it("counts this week's open commitments", async () => {
    const { getDashboardData } = await import("./service");

    expect((await getDashboardData("co_1"))!.headline.thisWeekOpen).toBe(2);
  });
});

describe("getDashboardData — keep-rate trend", () => {
  it("returns 12 weekly points, oldest first, ending on this Friday", async () => {
    const { getDashboardData } = await import("./service");

    const trend = (await getDashboardData("co_1"))!.keepRateTrend;

    expect(trend).toHaveLength(12);
    expect(trend[0].weekEnding).toBe(OLDEST_TREND_WEEK);
    expect(trend[11].weekEnding).toBe(THIS_FRIDAY);
    expect(trend.map((p) => p.isCurrentWeek).filter(Boolean)).toHaveLength(1);
    expect(trend[11].isCurrentWeek).toBe(true);
  });

  it("fills weeks with no resolved rows as null rather than zero", async () => {
    // A zero would read as "everyone missed"; null reads as "no data".
    const { getDashboardData } = await import("./service");

    const trend = (await getDashboardData("co_1"))!.keepRateTrend;
    const byWeek = new Map(trend.map((p) => [p.weekEnding, p.keepRate]));

    expect(byWeek.get(OLDEST_TREND_WEEK)).toBeNull();
    // 1 of 2 on time this week, 2 of 2 the week before.
    expect(byWeek.get(THIS_FRIDAY)).toBe(50);
    expect(byWeek.get("2026-08-28")).toBe(100);
  });
});

describe("getDashboardData — people", () => {
  it("rolls up per-owner counts and sorts by keep rate ascending, nulls last", async () => {
    const { getDashboardData } = await import("./service");

    const people = (await getDashboardData("co_1"))!.people;

    // Ben: 1 kept_late + 1 missed → 0% on time. Ana: 2 on time → 100%.
    // Cara: no resolved rows → null, sorted last.
    expect(people.map((p) => p.id)).toEqual(["p_ben", "p_ana", "p_cara"]);
    expect(people[0]).toEqual({
      id: "p_ben",
      full_name: "Ben Osei",
      position: "Ops Lead",
      reports_to: "p_ana",
      openCount: 0,
      keptOnTimeCount: 0,
      keptLateCount: 1,
      missedCount: 1,
      keepRate: 0,
    });
    expect(people[1].keepRate).toBe(100);
    expect(people[1].openCount).toBe(1);
    expect(people[2]).toMatchObject({
      id: "p_cara",
      position: null,
      openCount: 2,
      keepRate: null,
    });
  });

  it("never attributes an unassigned commitment to a person", async () => {
    const { getDashboardData } = await import("./service");

    const people = (await getDashboardData("co_1"))!.people;
    const totalOpen = people.reduce((sum, p) => sum + p.openCount, 0);

    // Four open rows in the fixture, one of them unassigned.
    expect(totalOpen).toBe(3);
  });
});

describe("getDashboardData — recent successes", () => {
  it("resolves owner names and priority titles, with fallbacks", async () => {
    const { getDashboardData } = await import("./service");

    const wins = (await getDashboardData("co_1"))!.recentSuccesses;

    expect(wins).toHaveLength(2);
    expect(wins[0]).toEqual({
      id: "c_win",
      description: "Signed the Fairbanks contract",
      completedAt: "2026-08-27T10:00:00Z",
      weekEnding: "2026-08-28",
      ownerId: "p_ana",
      ownerName: "Ana Ruiz",
      priorityTitle: "Northern expansion",
    });
    // No owner → "Unassigned" (not an em-dash, which is reserved for
    // an owner id that doesn't resolve). No priority → null.
    expect(wins[1]).toMatchObject({
      ownerId: null,
      ownerName: "Unassigned",
      priorityTitle: null,
    });
  });

  it("returns an empty list when there is no open quarter", async () => {
    mocks.getCurrentQuarter.mockResolvedValue(null);
    const { getDashboardData } = await import("./service");

    const data = (await getDashboardData("co_1"))!;

    expect(data.recentSuccesses).toEqual([]);
    expect(data.openQuarter).toBeNull();
  });
});

describe("getDashboardData — no open quarter", () => {
  it("zeroes the quarter-scoped numbers instead of throwing", async () => {
    mocks.getCurrentQuarter.mockResolvedValue(null);
    const { getDashboardData } = await import("./service");

    const data = (await getDashboardData("co_1"))!;

    expect(data.headline.onTrack).toEqual({ good: 0, total: 0 });
    expect(data.headline.keepRatePercent).toBeNull();
    expect(data.headline.clarityTotalCount).toBe(0);
    // Trend and roster are not quarter-scoped and still populate.
    expect(data.keepRateTrend).toHaveLength(12);
    expect(data.people).toHaveLength(3);
  });
});
