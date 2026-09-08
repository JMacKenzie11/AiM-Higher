import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// CONTRACT TESTS for getCommitmentsPageData.
//
// /commitments is the most-used surface in the product and had no unit
// coverage at all — its only guard was the e2e spec, which creates one
// commitment and looks for it. That is enough to catch a page that
// breaks and not enough to catch a page that quietly reorders.
//
// Written alongside the change that turned eleven sequential round
// trips into three waves. That change moves only scheduling: same
// queries, same filters, same shaping. These tests pin the part a
// scheduling change could plausibly disturb — which rows land in which
// bucket, and in what order — so "byte-identical" is a thing the suite
// checks rather than a thing the diff claims.
//
// THE FAKE keys fixtures on a query SIGNATURE (the columns selected
// plus which filter shapes were used), because this loader hits
// `commitments` four times with the same `select("*")` and only the
// filters tell them apart. It does not implement filtering — each
// fixture is pre-filtered to what that query would have returned.
// Re-implementing PostgREST would only test the stub.

const FROZEN_NOW = new Date("2026-09-02T18:00:00Z"); // a Wednesday
const THIS_FRIDAY = "2026-09-04";
const LAST_FRIDAY = "2026-08-28";
const TWO_FRIDAYS_AGO = "2026-08-21";
const NEXT_FRIDAY = "2026-09-11";

const mocks = vi.hoisted(() => {
  const rows = new Map<string, unknown[]>();
  return { rows };
});

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: (table: string) => {
      const ops: string[] = [];
      const chain: Record<string, unknown> = {};
      const pass = () => chain;
      const note = (op: string) => (...args: unknown[]) => {
        ops.push(`${op}:${String(args[0])}`);
        return chain;
      };
      Object.assign(chain, {
        select: note("select"),
        eq: note("eq"),
        neq: pass,
        is: pass,
        in: note("in"),
        lt: note("lt"),
        gte: pass,
        lte: pass,
        not: note("not"),
        order: note("order"),
        maybeSingle: async () => ({
          data: (mocks.rows.get(signature(table, ops)) ?? [])[0] ?? null,
        }),
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({
            data: mocks.rows.get(signature(table, ops)) ?? [],
          }).then(resolve),
      });
      return chain;
    },
  }),
}));

// Names each distinct query this loader issues. Kept deliberately
// small and readable: the point is to tell four commitment reads
// apart, not to model a query planner.
function signature(table: string, ops: string[]): string {
  const has = (o: string) => ops.some((x) => x.startsWith(o));
  if (table === "commitments") {
    if (has("select:status")) return "commitments:keepRate";
    if (has("not:parked_at")) return "commitments:parked";
    if (has("lt:week_ending")) return "commitments:stranded";
    return "commitments:main";
  }
  if (table === "profiles") {
    return has("eq:role") ? "profiles:coaches" : "profiles:roster";
  }
  if (table === "priorities") {
    return has("in:id") ? "priorities:enrich" : "priorities:options";
  }
  if (table === "functions") {
    return has("in:id") ? "functions:enrich" : "functions:options";
  }
  return table;
}

vi.mock("@/lib/quarters/service", () => ({
  // Mocked rather than seeded: getCurrentQuarter is React
  // cache()-wrapped, and a memo outliving a test would hand the next
  // case this one's quarter.
  getCurrentQuarter: async () => ({
    id: "q_1",
    company_id: "co_1",
    label: "Q3 2026",
    start_date: "2026-07-01",
    end_date: "2026-09-30",
    status: "open",
  }),
}));

function commitment(
  id: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id,
    company_id: "co_1",
    description: id,
    owner_id: null,
    priority_id: null,
    issue_id: null,
    functional_area_id: null,
    week_ending: THIS_FRIDAY,
    due_date: THIS_FRIDAY,
    status: "open",
    deleted_at: null,
    parked_at: null,
    ...overrides,
  };
}

function seed(key: string, value: unknown[]) {
  mocks.rows.set(key, value);
}

function seedBaseline() {
  seed("companies", [{ timezone: "America/Anchorage" }]);
  seed("profiles:roster", [
    { id: "u_ann", full_name: "Ann Adams", position: "COO" },
    { id: "u_bob", full_name: "Bob Brown", position: "Ops" },
  ]);
  seed("profiles:coaches", [
    // Already on the roster: must be deduped, not listed twice.
    { id: "u_ann", full_name: "Ann Adams", position: "COO" },
    { id: "u_coach", full_name: "Zoe Coach", position: "AiMS" },
  ]);
  seed("priorities:options", [{ id: "p_1", title: "Ship the thing" }]);
  seed("functions:options", [{ id: "f_1", title: "Operations" }]);
  seed("priorities:enrich", [{ id: "p_1", title: "Ship the thing" }]);
  seed("functions:enrich", [{ id: "f_1", title: "Operations" }]);
  seed("commitments:main", []);
  seed("commitments:stranded", []);
  seed("commitments:parked", []);
  seed("commitments:keepRate", []);
}

const ALL = { owner: "all", status: "all", type: "all" } as const;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FROZEN_NOW);
  mocks.rows.clear();
  seedBaseline();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getCommitmentsPageData — bucketing", () => {
  it("splits rows into needs-attention, this week, future and prior weeks", async () => {
    seed("commitments:main", [
      commitment("this_week_open"),
      commitment("this_week_kept", { status: "kept_on_time" }),
      commitment("future", {
        week_ending: NEXT_FRIDAY,
        due_date: NEXT_FRIDAY,
      }),
      commitment("prior_resolved", {
        week_ending: LAST_FRIDAY,
        due_date: LAST_FRIDAY,
        status: "missed",
      }),
      // Past week, still open: belongs in the main list, not in the
      // prior-week summary.
      commitment("past_open", {
        week_ending: LAST_FRIDAY,
        due_date: LAST_FRIDAY,
      }),
    ]);
    const { getCommitmentsPageData } = await import("./service");

    const data = await getCommitmentsPageData("co_1", "u_ann", ALL);

    expect(data.mainList.map((c) => c.id).sort()).toEqual([
      "past_open",
      "this_week_kept",
      "this_week_open",
    ]);
    expect(data.futureList.map((c) => c.id)).toEqual(["future"]);
    expect(data.priorWeeks.map((w) => w.weekEnding)).toEqual([LAST_FRIDAY]);
    expect(data.priorWeeks[0].commitments.map((c) => c.id)).toEqual([
      "prior_resolved",
    ]);
  });

  it("folds stranded past-week open rows into the main list", async () => {
    // Rows from before the window that are still open. They arrive
    // from a second query and must land in the same bucket as the
    // in-window past-week open rows.
    seed("commitments:main", [commitment("in_window")]);
    seed("commitments:stranded", [
      commitment("stranded_open", {
        week_ending: "2026-05-01",
        due_date: "2026-05-01",
      }),
    ]);
    const { getCommitmentsPageData } = await import("./service");

    const data = await getCommitmentsPageData("co_1", "u_ann", ALL);

    expect(data.mainList.map((c) => c.id).sort()).toEqual([
      "in_window",
      "stranded_open",
    ]);
  });

  it("keeps the parking lot out of every other bucket", async () => {
    seed("commitments:parked", [
      commitment("parked_old", { parked_at: "2026-08-01T00:00:00Z" }),
      commitment("parked_new", { parked_at: "2026-08-20T00:00:00Z" }),
    ]);
    const { getCommitmentsPageData } = await import("./service");

    const data = await getCommitmentsPageData("co_1", "u_ann", ALL);

    // Newest first.
    expect(data.parkedList.map((c) => c.id)).toEqual([
      "parked_new",
      "parked_old",
    ]);
    expect(data.mainList).toEqual([]);
    expect(data.futureList).toEqual([]);
    expect(data.priorWeeks).toEqual([]);
    // And never in the counts.
    expect(data.headerStats.openThisWeek).toBe(0);
    expect(data.headerStats.needsAttentionCount).toBe(0);
  });
});

describe("getCommitmentsPageData — ordering", () => {
  it("sorts the main list by owner name, then due date, unassigned last", async () => {
    seed("commitments:main", [
      commitment("bob_late", { owner_id: "u_bob", due_date: "2026-09-04" }),
      commitment("unassigned", { owner_id: null }),
      commitment("ann_late", { owner_id: "u_ann", due_date: "2026-09-04" }),
      commitment("ann_early", { owner_id: "u_ann", due_date: "2026-09-01" }),
    ]);
    const { getCommitmentsPageData } = await import("./service");

    const data = await getCommitmentsPageData("co_1", "u_ann", ALL);

    expect(data.mainList.map((c) => c.id)).toEqual([
      "ann_early",
      "ann_late",
      "bob_late",
      "unassigned",
    ]);
  });

  it("orders prior weeks newest first and summarises each", async () => {
    seed("commitments:main", [
      commitment("older", {
        week_ending: TWO_FRIDAYS_AGO,
        status: "kept_on_time",
      }),
      commitment("newer_kept", {
        week_ending: LAST_FRIDAY,
        status: "kept_on_time",
      }),
      commitment("newer_late", {
        week_ending: LAST_FRIDAY,
        status: "kept_late",
      }),
      commitment("newer_missed", {
        week_ending: LAST_FRIDAY,
        status: "missed",
      }),
    ]);
    const { getCommitmentsPageData } = await import("./service");

    const data = await getCommitmentsPageData("co_1", "u_ann", ALL);

    expect(data.priorWeeks.map((w) => w.weekEnding)).toEqual([
      LAST_FRIDAY,
      TWO_FRIDAYS_AGO,
    ]);
    expect(data.priorWeeks[0]).toMatchObject({
      keptOnTimeCount: 1,
      keptLateCount: 1,
      missedCount: 1,
    });
  });

  it("puts company members before appended coaches and dedupes the overlap", async () => {
    const { getCommitmentsPageData } = await import("./service");

    const data = await getCommitmentsPageData("co_1", "u_ann", ALL);

    expect(data.roster.map((p) => p.id)).toEqual(["u_ann", "u_bob", "u_coach"]);
  });
});

describe("getCommitmentsPageData — header stats and enrichment", () => {
  it("counts open-this-week and needs-attention independently of filters", async () => {
    seed("commitments:main", [
      commitment("open_now"),
      commitment("kept_now", { status: "kept_on_time" }),
      commitment("overdue", { week_ending: LAST_FRIDAY }),
    ]);
    const { getCommitmentsPageData } = await import("./service");

    const filtered = await getCommitmentsPageData("co_1", "u_ann", {
      owner: "me",
      status: "all",
      type: "all",
    });

    // Nothing is owned by u_ann, so every list is empty...
    expect(filtered.mainList).toEqual([]);
    // ...but the header still reports the shape of the week, which is
    // the point of computing it before filtering.
    expect(filtered.headerStats.openThisWeek).toBe(1);
    expect(filtered.headerStats.needsAttentionCount).toBe(1);
  });

  it("attaches owner, priority and functional area to every row", async () => {
    seed("commitments:main", [
      commitment("rich", {
        owner_id: "u_bob",
        priority_id: "p_1",
      }),
      commitment("area", { functional_area_id: "f_1" }),
    ]);
    const { getCommitmentsPageData } = await import("./service");

    const data = await getCommitmentsPageData("co_1", "u_ann", ALL);
    const byId = new Map(data.mainList.map((c) => [c.id, c]));

    expect(byId.get("rich")?.owner?.full_name).toBe("Bob Brown");
    expect(byId.get("rich")?.priority).toEqual({
      id: "p_1",
      title: "Ship the thing",
    });
    expect(byId.get("area")?.functionalArea).toEqual({
      id: "f_1",
      title: "Operations",
    });
    // Always null on this loader: the page filters issue-linked rows
    // out entirely.
    expect(byId.get("rich")?.issue).toBeNull();
  });

  it("returns the picker options and the week anchors the page renders", async () => {
    const { getCommitmentsPageData } = await import("./service");

    const data = await getCommitmentsPageData("co_1", "u_ann", ALL);

    expect(data.thisFriday).toBe(THIS_FRIDAY);
    expect(data.timezone).toBe("America/Anchorage");
    expect(data.quarterCoversThisWeek).toBe(true);
    expect(data.priorityOptions).toEqual([
      { id: "p_1", title: "Ship the thing" },
    ]);
    expect(data.functionalAreaOptions).toEqual([
      { id: "f_1", title: "Operations" },
    ]);
  });
});
