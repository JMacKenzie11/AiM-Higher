import { describe, it, expect, beforeEach, vi } from "vitest";

// Data parity with the underlying loaders, on a fixture.
//
// The claim /portfolio makes is that its numbers are the SAME numbers
// the company's own surfaces show, computed by the same rules. So the
// fixture here feeds the real shared functions — summarizePriorityHealth
// and summarizeFollowThrough are imported, not mocked — and the test
// asserts the card matches what those return for the same rows. Mocking
// them would test that the loader calls something, which is not the
// claim.

const mocks = vi.hoisted(() => {
  const companies = vi.fn();
  const priorities = vi.fn();
  const commitments = vi.fn();
  const occurrences = vi.fn();
  const snapshots = vi.fn();
  const currentQuarter = vi.fn();

  // A chainable query builder that resolves to whatever the matching
  // spy returns. Table name decides which.
  const from = (table: string) => {
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    for (const m of ["select", "eq", "is", "order", "in", "gte", "lte"]) {
      builder[m] = vi.fn(chain);
    }
    builder.then = (onFulfilled: (v: unknown) => unknown) => {
      if (table === "companies") return Promise.resolve(companies()).then(onFulfilled);
      if (table === "priorities") return Promise.resolve(priorities()).then(onFulfilled);
      if (table === "commitments") return Promise.resolve(commitments()).then(onFulfilled);
      // The resolved weeks of any recurring commitment. Follow-Through
      // counts one unit per week, not one per commitment row.
      if (table === "commitment_occurrences")
        return Promise.resolve(occurrences()).then(onFulfilled);
      throw new Error(`Unexpected table: ${table}`);
    };
    return builder;
  };

  return { companies, priorities, commitments, occurrences, snapshots, currentQuarter, from };
});

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ from: mocks.from }),
}));
vi.mock("@/lib/instances/current", () => ({
  getCurrentInstanceConfig: () => ({}),
}));
vi.mock("@/lib/maturity/service", () => ({
  loadLatestOverallSnapshots: mocks.snapshots,
}));
vi.mock("@/lib/quarters/service", () => ({
  getCurrentQuarter: mocks.currentQuarter,
}));
// Today is fixed so thisFriday and the overdue-open cutoff are
// deterministic. 2026-09-14 is a Monday; that week ends Friday the 18th.
//
// THIS FRIDAY IS MOCKED TOO, and it has to be. Mocking only
// todayInTimezone looks sufficient and is not: thisFriday calls
// todayInTimezone from INSIDE the same module, so it reaches the real
// implementation and the real clock no matter what the export is
// replaced with.
//
// The test passed anyway, every day of the week this was written in,
// because the hard-coded 2026-09-18 happened to be the real current
// Friday. It went red on Saturday 2026-09-19 when the real clock
// rolled to the next week. A test whose green depends on the day it
// is run is not measuring the thing it names.
//
// The spy also lets the timezone claim actually be asserted, which is
// what this file says it is checking and never was.
const thisFridaySpy = vi.fn((_tz: string) => "2026-09-18");
vi.mock("@/lib/dates", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/dates")>();
  return {
    ...actual,
    todayInTimezone: () => ({ iso: "2026-09-14", weekday: 1 }),
    thisFriday: (tz: string) => thisFridaySpy(tz),
  };
});

import { DISCIPLINES } from "@/lib/maturity/disciplines";

const COMPANY_A = {
  id: "co_a",
  name: "Acme",
  timezone: "America/Anchorage",
};

function primeOneCompany() {
  mocks.companies.mockResolvedValue({ data: [COMPANY_A] });
  mocks.currentQuarter.mockResolvedValue({
    id: "q1",
    label: "Q3 2026",
    start_date: "2026-07-01",
    end_date: "2026-09-30",
  });
  // The latest weekly snapshot: every discipline at 3.4, so the
  // weighted overall is 3.4 whatever the weights, across all eight.
  mocks.snapshots.mockResolvedValue(
    new Map([
      [
        "co_a",
        {
          date: "2026-09-11",
          score: 3.4,
          scores: DISCIPLINES.map((d) => ({ key: d.key, score: 3.4, breakdown: {} })),
        },
      ],
    ])
  );
  mocks.priorities.mockResolvedValue({
    data: [
      { status: "on_track" },
      { status: "complete" },
      { status: "off_track" },
      { status: "at_risk" },
    ],
  });
  mocks.commitments.mockResolvedValue({
    data: [
      { status: "kept_on_time", due_date: "2026-09-18" },
      { status: "kept_late", due_date: "2026-09-18" },
      { status: "missed", due_date: "2026-09-18" },
      // Open and strictly past due — counts against the rate.
      { status: "open", due_date: "2026-09-10" },
      // Open and not yet due — excluded entirely.
      { status: "open", due_date: "2026-09-18" },
    ],
  });
  // A recurring commitment's resolved weeks. Its parent row is the
  // "open, not yet due" one above: it never leaves 'open' while the
  // cycle runs, so before this population counted weeks, three kept
  // weeks were worth nothing at all.
  mocks.occurrences.mockResolvedValue({
    data: [{ status: "kept_on_time" }, { status: "kept_on_time" }],
  });
}

describe("loadPortfolioOverview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeOneCompany();
  });

  it("matches summarizePriorityHealth on the same rows", async () => {
    const { summarizePriorityHealth } = await import(
      "@/lib/plan/priority-health"
    );
    const { loadPortfolioOverview } = await import("./service");

    const [card] = await loadPortfolioOverview();
    const expected = summarizePriorityHealth(
      (await mocks.priorities.mock.results[0].value).data
    );

    expect(card.priorityGood).toBe(expected.good);
    expect(card.priorityTotal).toBe(expected.total);
    expect(card.priorityPercent).toBe(expected.percent);
    // 2 of 4, spelled out so a silent change to the rule is visible.
    expect(card.priorityPercent).toBe(50);
  });

  it("matches summarizeFollowThrough on the same rows", async () => {
    const { summarizeFollowThrough } = await import(
      "@/lib/commitments/follow-through"
    );
    const { mergeFollowThroughRows } = await import(
      "@/lib/commitments/follow-through-rows"
    );
    const { loadPortfolioOverview } = await import("./service");

    const [card] = await loadPortfolioOverview();
    // The same rows the loader saw, merged by the same function it
    // uses: commitments PLUS the resolved weeks of the recurring one.
    // Building the expectation from commitments alone would assert
    // the population this page used to have.
    const expected = summarizeFollowThrough(
      mergeFollowThroughRows(
        (await mocks.commitments.mock.results[0].value).data,
        (await mocks.occurrences.mock.results[0].value).data
      ),
      "2026-09-14"
    );

    expect(card.week).toEqual(expected);
    // Three kept on time out of six in the denominator. One is the
    // plain kept commitment; the other two are weeks of the recurring
    // one, which used to be invisible here — its parent row is the
    // not-yet-due open row, and that is excluded entirely.
    expect(card.week.keptOnTime).toBe(3);
    expect(card.week.resolved).toBe(6);
    expect(card.week.rate).toBe(50);
  });

  it("carries the scorecard's denominator alongside the score", async () => {
    // The number on its own invites a comparison between cards that is
    // not valid unless both cover the same disciplines.
    const { loadPortfolioOverview } = await import("./service");

    const [card] = await loadPortfolioOverview();

    expect(card.scorecardOverall).toBe(3.4);
    expect(card.scorecardDisciplines).toBe(DISCIPLINES.length);
  });

  it("dates the score with its snapshot", async () => {
    // The score is last week's snapshot, not a live compute, so the
    // card has to be able to say how old it is.
    const { loadPortfolioOverview } = await import("./service");

    const [card] = await loadPortfolioOverview();

    expect(card.scorecardAsOf).toBe("2026-09-11");
  });

  it("reads every company's score in one query, not one per company", async () => {
    // The live compute per company is what ran reads past the
    // database's time limit on dev (2026-09-30).
    mocks.companies.mockResolvedValue({
      data: [COMPANY_A, { id: "co_b", name: "Beta", timezone: "America/Toronto" }],
    });
    const { loadPortfolioOverview } = await import("./service");

    const cards = await loadPortfolioOverview();

    expect(cards).toHaveLength(2);
    expect(mocks.snapshots).toHaveBeenCalledTimes(1);
    expect(mocks.snapshots).toHaveBeenCalledWith(["co_a", "co_b"]);
  });

  it("ends the week in the COMPANY's timezone, not the viewer's", async () => {
    const { loadPortfolioOverview } = await import("./service");

    const [card] = await loadPortfolioOverview();

    expect(card.weekEnding).toBe("2026-09-18");
    // The actual claim: the company's zone was the one asked about.
    // Asserting only the date above cannot tell a correct answer from
    // one that read the server's clock and happened to agree.
    expect(thisFridaySpy).toHaveBeenCalledWith("America/Anchorage");
  });

  it("has no score, never zero, for a company with no snapshot yet", async () => {
    // A new company the weekly cron has not reached.
    mocks.snapshots.mockResolvedValue(new Map());
    const { loadPortfolioOverview } = await import("./service");

    const [card] = await loadPortfolioOverview();

    expect(card.scorecardOverall).toBeNull();
    expect(card.scorecardDisciplines).toBe(0);
    expect(card.scorecardAsOf).toBeNull();
    expect(card.name).toBe("Acme");
  });

  it("reports a null quarter rather than inventing one", async () => {
    mocks.currentQuarter.mockResolvedValue(null);
    const { loadPortfolioOverview } = await import("./service");

    const [card] = await loadPortfolioOverview();

    expect(card.quarterLabel).toBeNull();
    expect(card.priorityTotal).toBe(0);
    expect(card.priorityPercent).toBeNull();
  });

  it("renders a single-company instance as one ordinary card", async () => {
    // No special casing anywhere: one company is the same shape as ten.
    const { loadPortfolioOverview } = await import("./service");

    const cards = await loadPortfolioOverview();

    expect(cards).toHaveLength(1);
    expect(cards[0].id).toBe("co_a");
    expect(cards[0].scorecardOverall).toBe(3.4);
  });

  it("returns an empty list for an empty instance, and asks for nothing else", async () => {
    mocks.companies.mockResolvedValue({ data: [] });
    const { loadPortfolioOverview } = await import("./service");

    const cards = await loadPortfolioOverview();

    expect(cards).toEqual([]);
    // The page renders the create affordance from this; it must not
    // have paid for a scorecard read to find out.
    expect(mocks.snapshots).not.toHaveBeenCalled();
    expect(mocks.currentQuarter).not.toHaveBeenCalled();
  });
});
