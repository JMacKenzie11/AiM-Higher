import { describe, it, expect, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  scorecard: null as unknown,
  cascade: null as unknown,
  lastFilters: [] as string[][],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/instances/current", () => ({
  getCurrentInstanceConfig: async () => ({ subdomain: "t" }),
}));
vi.mock("@/lib/maturity/service", () => ({
  loadCompanyScorecard: async () => mocks.scorecard,
}));
vi.mock("@/lib/plan/service", () => ({ getCascade: async () => mocks.cascade }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: (table: string) => {
      const applied: string[] = [`from:${table}`];
      mocks.lastFilters.push(applied);
      const chain: Record<string, unknown> = {};
      const note =
        (op: string) =>
        (...a: unknown[]) => {
          applied.push(`${op}:${String(a[0])}`);
          return chain;
        };
      Object.assign(chain, {
        select: note("select"),
        eq: note("eq"),
        in: note("in"),
        is: note("is"),
        gte: note("gte"),
        lte: note("lte"),
        order: note("order"),
        limit: note("limit"),
        then: (r: (v: unknown) => unknown) =>
          Promise.resolve({ data: mocks.tables[table] ?? [], error: null }).then(r),
      });
      return chain;
    },
  }),
}));

import { buildHistoryTools } from "./history-tools";

function toolNamed(name: string, subject: string | null = "p_1") {
  const t = buildHistoryTools({ subjectProfileId: subject, companyId: "co_1" }).find(
    (x) => x.definition.name === name
  );
  if (!t) throw new Error(`no tool ${name}`);
  return t;
}

const QUARTERS = [
  { id: "q4", label: "Q4 2026", start_date: "2026-10-01", end_date: "2026-12-31", status: "closed" },
  { id: "q3", label: "Q3 2026", start_date: "2026-07-01", end_date: "2026-09-30", status: "closed" },
  { id: "q2", label: "Q2 2026", start_date: "2026-04-01", end_date: "2026-06-30", status: "closed" },
];

// A person with three quarters of record, and one with two weeks.
const THICK = [
  { description: "ship the hiring plan", status: "kept_on_time", due_date: "2026-11-06", week_ending: "2026-11-06", completed_at: "2026-11-05T00:00:00Z", missed_reason: null },
  { description: "hiring pipeline review", status: "missed", due_date: "2026-11-13", week_ending: "2026-11-13", completed_at: null, missed_reason: "waiting on Dana to approve" },
  { description: "onboarding checklist", status: "kept_late", due_date: "2026-08-07", week_ending: "2026-08-07", completed_at: "2026-08-08T00:00:00Z", missed_reason: null },
  { description: "onboarding revamp", status: "missed", due_date: "2026-08-14", week_ending: "2026-08-14", completed_at: null, missed_reason: "blocked on legal" },
  { description: "q2 thing", status: "kept_on_time", due_date: "2026-05-01", week_ending: "2026-05-01", completed_at: "2026-05-01T00:00:00Z", missed_reason: null },
];

const THIN = [
  { description: "first commitment", status: "kept_on_time", due_date: "2026-11-06", week_ending: "2026-11-06", completed_at: "2026-11-06T00:00:00Z", missed_reason: null },
];

describe("commitment_history", () => {
  it("summarizes by quarter with verbatim miss reasons", async () => {
    mocks.tables = { quarters: QUARTERS, commitments: THICK };
    const out = (await toolNamed("commitment_history").handler({
      scope: "person",
      quarters_back: 3,
    })) as { status: string; quarters: Array<{ quarter_label: string; follow_through_pct: number | null; miss_reasons: string[] }> };

    expect(out.status).toBe("ok");
    expect(out.quarters.map((q) => q.quarter_label)).toEqual(["Q4 2026", "Q3 2026", "Q2 2026"]);
    // Q4: one kept, one missed → 50%.
    expect(out.quarters[0]?.follow_through_pct).toBe(50);
    // The person's own words, unparaphrased — the most
    // coaching-useful thing in the payload.
    expect(out.quarters[0]?.miss_reasons).toEqual(["waiting on Dana to approve"]);
    expect(out.quarters[2]?.follow_through_pct).toBe(100);
  });

  it("reports a THIN record as thin rather than as a pattern", async () => {
    // Two weeks of history is one data point. The tool must hand back
    // something the coach can honestly say "there is not much here"
    // about, instead of a 100% rate that reads like a track record.
    mocks.tables = { quarters: QUARTERS, commitments: THIN };
    const out = (await toolNamed("commitment_history").handler({
      scope: "person",
      quarters_back: 3,
    })) as { quarters: Array<{ follow_through_pct: number | null; kept_on_time: number }> };

    expect(out.quarters[0]?.follow_through_pct).toBe(100);
    expect(out.quarters[0]?.kept_on_time).toBe(1);
    // The two older quarters carry NO rate, which is what makes the
    // record legibly thin rather than perfect.
    expect(out.quarters[1]?.follow_through_pct).toBeNull();
    expect(out.quarters[2]?.follow_through_pct).toBeNull();
  });

  it("returns status='empty' when the company has no quarters", async () => {
    mocks.tables = { quarters: [], commitments: [] };
    const out = (await toolNamed("commitment_history").handler({ scope: "company" })) as {
      status: string;
    };
    expect(out.status).toBe("empty");
  });

  it("excludes deleted and parked rows in the QUERY", async () => {
    mocks.tables = { quarters: QUARTERS, commitments: THICK };
    mocks.lastFilters = [];
    await toolNamed("commitment_history").handler({ scope: "company" });
    const cmt = mocks.lastFilters.find((f) => f[0] === "from:commitments");
    expect(cmt).toContain("is:deleted_at");
    expect(cmt).toContain("is:parked_at");
  });

  it("scopes to the subject only when asked, and never to a model-supplied id", async () => {
    mocks.tables = { quarters: QUARTERS, commitments: THICK };
    mocks.lastFilters = [];
    await toolNamed("commitment_history").handler({ scope: "person" });
    expect(mocks.lastFilters.find((f) => f[0] === "from:commitments")).toContain("eq:owner_id");

    mocks.lastFilters = [];
    // The schema has no person id to supply, and a stray one is ignored.
    await toolNamed("commitment_history").handler({
      scope: "person",
      person_id: "somebody_else",
    } as unknown);
    const applied = mocks.lastFilters.find((f) => f[0] === "from:commitments") ?? [];
    expect(applied.filter((f) => f.startsWith("eq:owner_id"))).toHaveLength(1);
  });

  it("offers no person scope when the conversation has no subject", () => {
    const schema = toolNamed("commitment_history", null).definition
      .input_schema as { properties: { scope: { enum: string[] } } };
    expect(schema.properties.scope.enum).toEqual(["company"]);
  });

  it("clamps quarters_back to the documented cap", async () => {
    mocks.tables = { quarters: QUARTERS, commitments: THICK };
    mocks.lastFilters = [];
    await toolNamed("commitment_history").handler({ scope: "company", quarters_back: 99 });
    expect(mocks.lastFilters.find((f) => f[0] === "from:quarters")).toContain("limit:6");
  });
});

describe("scorecard_trajectory", () => {
  const point = (date: string, scores: Array<[string, number | null]>) => ({
    date,
    score: 5,
    scores: scores.map(([key, score]) => ({ key, score, breakdown: {} })),
  });

  it("compares like for like when the discipline set changes mid-window", async () => {
    // The whole reason this reuses compareOverall. A company that
    // switched a module on has two overalls built from different
    // disciplines; subtracting them invents a change nobody caused.
    mocks.scorecard = {
      timeseries: { execution: [{ date: "2026-01-02", score: 6 }, { date: "2026-01-09", score: 7 }] },
      overallTimeseries: [
        point("2026-01-02", [["execution", 6]]),
        point("2026-01-09", [["execution", 7], ["measures", 2]]),
      ],
    };
    const out = (await toolNamed("scorecard_trajectory").handler({ weeks_back: 4 })) as {
      status: string;
      overall_comparison: { delta: number; disciplines_compared: number } | null;
    };
    expect(out.status).toBe("ok");
    expect(out.overall_comparison?.disciplines_compared).toBe(1);
    expect(out.overall_comparison?.delta).toBe(1);
  });

  it("returns empty below two snapshots instead of a trend", async () => {
    mocks.scorecard = { timeseries: {}, overallTimeseries: [point("2026-01-02", [["execution", 6]])] };
    const out = (await toolNamed("scorecard_trajectory").handler({})) as { status: string };
    expect(out.status).toBe("empty");
  });

  it("says so when nothing scored at both ends", async () => {
    mocks.scorecard = {
      timeseries: {},
      overallTimeseries: [
        point("2026-01-02", [["execution", 6]]),
        point("2026-01-09", [["measures", 2]]),
      ],
    };
    const out = (await toolNamed("scorecard_trajectory").handler({})) as {
      overall_comparison: unknown;
      comparison_note: string;
    };
    expect(out.overall_comparison).toBeNull();
    expect(out.comparison_note).toContain("no like-for-like");
  });
});

describe("issue_casefiles", () => {
  it("returns the attempts in order, with what closed it", async () => {
    mocks.tables = {
      quarters: QUARTERS,
      issues: [
        {
          id: "i_1",
          title: "Invoices go out late",
          desired_outcome: "Out by the 3rd",
          created_at: "2026-10-01T00:00:00Z",
          resolved_at: "2026-10-29T00:00:00Z",
          resolved_in_meeting: false,
        },
      ],
      commitments: [
        { id: "c1", issue_id: "i_1", description: "Chase the biller", status: "missed", due_date: "2026-10-09", week_ending: "2026-10-09", completed_at: null, missed_reason: "no reply", created_at: "2026-10-02T00:00:00Z", owner_id: "p_1", parked_at: null, deleted_at: null },
        { id: "c2", issue_id: "i_1", description: "Automate the run", status: "kept_on_time", due_date: "2026-10-23", week_ending: "2026-10-23", completed_at: "2026-10-22T00:00:00Z", missed_reason: null, created_at: "2026-10-16T00:00:00Z", owner_id: "p_1", parked_at: null, deleted_at: null },
      ],
    };
    const out = (await toolNamed("issue_casefiles").handler({})) as {
      status: string;
      casefiles: Array<{ attempts: Array<{ commitment: string; outcome: string }>; days_to_resolution: number }>;
    };
    expect(out.status).toBe("ok");
    expect(out.casefiles[0]?.attempts.map((a) => a.commitment)).toEqual([
      "Chase the biller",
      "Automate the run",
    ]);
    expect(out.casefiles[0]?.days_to_resolution).toBe(28);
  });

  it("returns empty rather than an empty list shape", async () => {
    mocks.tables = { quarters: QUARTERS, issues: [], commitments: [] };
    const out = (await toolNamed("issue_casefiles").handler({})) as { status: string };
    expect(out.status).toBe("empty");
  });
});

describe("planning_history", () => {
  it("reports what was planned against its final status", async () => {
    mocks.tables = { quarters: QUARTERS };
    mocks.cascade = {
      sfas: [
        {
          title: "Operational excellence",
          goals: [
            {
              title: "Cut cycle time",
              status: "on_track",
              priorities: [
                { title: "Map the flow", status: "complete" },
                { title: "Kill the handoff", status: "off_track" },
              ],
            },
          ],
        },
      ],
      orphanGoals: [],
      orphanPriorities: [],
    };
    const out = (await toolNamed("planning_history").handler({ quarters_back: 1 })) as {
      status: string;
      quarters: Array<{ strategic_focus_areas: string[]; priority_counts: Record<string, number> }>;
    };
    expect(out.status).toBe("ok");
    expect(out.quarters[0]?.strategic_focus_areas).toEqual(["Operational excellence"]);
    expect(out.quarters[0]?.priority_counts).toEqual({ complete: 1, off_track: 1 });
  });

  it("returns empty when no quarter has closed", async () => {
    mocks.tables = { quarters: [] };
    const out = (await toolNamed("planning_history").handler({})) as { status: string };
    expect(out.status).toBe("empty");
  });
});

// The property that matters most, and the one a behavioural test
// cannot reach: RLS is the boundary, so a tool that reached for the
// service client would silently widen visibility for every role at
// once. Failure mode E5.
describe("history tools run as the caller", () => {
  it("no service client, and no conversation reads, in the history module", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/lib/coach/history-tools.ts", "utf8").replace(
      /^\s*\/\/.*$/gm,
      ""
    );
    expect(src).not.toMatch(/createSupabaseAdminClient/);
    // The tier-one scope boundary, enforced rather than described.
    expect(src).not.toMatch(/coaching_conversations|coaching_messages/);
  });
});
