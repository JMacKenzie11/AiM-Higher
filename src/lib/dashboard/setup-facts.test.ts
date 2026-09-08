import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// loadSetupFacts — the narrow read behind the /scorecard setup
// checklist.
//
// It replaces a call to getDashboardData, which builds the entire
// /dashboard read model in fifteen queries: focus areas, sponsors,
// progress rollups, twelve weeks of commitment trend, recent wins and
// their owner and priority lookups. The checklist reads three values
// out of all that. /scorecard was paying for the other twelve on
// every load, on top of its own live scorecard compute.
//
// So these tests pin two things: that the three values come back
// correctly, and that getting them costs two reads plus the already
// memoized quarter, and nothing else.
// The second matters as much as the first — the regression this fixes
// is not a wrong value, it is a right value fetched expensively, and
// only a query-shape assertion can catch that coming back.

const mocks = vi.hoisted(() => {
  const rows = new Map<string, unknown[]>();
  const tablesRead: string[] = [];
  return { rows, tablesRead };
});

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: (table: string) => {
      mocks.tablesRead.push(table);
      const chain: Record<string, unknown> = {};
      const pass = () => chain;
      const data = () => mocks.rows.get(table) ?? [];
      Object.assign(chain, {
        select: pass,
        eq: pass,
        neq: pass,
        in: pass,
        is: pass,
        order: pass,
        maybeSingle: async () => ({ data: data()[0] ?? null }),
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: data() }).then(resolve),
      });
      return chain;
    },
  }),
}));

// Mocked rather than driven through the fake client because
// getCurrentQuarter is React cache()-wrapped, and a memo that
// outlives a test would make the second case read the first case's
// quarter. What matters here is the value the checklist receives.
const quarter = vi.hoisted(() => ({ current: null as { label: string } | null }));
vi.mock("@/lib/quarters/service", () => ({
  getCurrentQuarter: async () => quarter.current,
}));

const { loadSetupFacts } = await import("./setup-steps");

beforeEach(() => {
  mocks.rows.clear();
  mocks.tablesRead.length = 0;
  quarter.current = null;
});

describe("loadSetupFacts", () => {
  it("returns the company name, the open quarter label and the roster ids", async () => {
    mocks.rows.set("companies", [{ name: "Meridian Construction Group" }]);
    mocks.rows.set("profiles", [{ id: "p_1" }, { id: "p_2" }, { id: "p_3" }]);
    quarter.current = { label: "Q3 2026" };

    expect(await loadSetupFacts("co_1")).toEqual({
      companyName: "Meridian Construction Group",
      openQuarterLabel: "Q3 2026",
      rosterIds: ["p_1", "p_2", "p_3"],
    });
  });

  it("reports no open quarter as null rather than omitting it", async () => {
    mocks.rows.set("companies", [{ name: "Acme" }]);
    mocks.rows.set("profiles", []);

    const facts = await loadSetupFacts("co_1");

    expect(facts).toEqual({
      companyName: "Acme",
      openQuarterLabel: null,
      rosterIds: [],
    });
  });

  it("returns null when the company row is missing", async () => {
    // Same condition getDashboardData returned null for, so the
    // checklist keeps rendering nothing rather than a card titled
    // "undefined".
    mocks.rows.set("profiles", [{ id: "p_1" }]);

    expect(await loadSetupFacts("co_gone")).toBeNull();
  });

  it("reads two tables and no more", async () => {
    // The point of the change. Before, this path went through
    // getDashboardData and touched strategic_focus_areas,
    // annual_goals, sfa_progress, priorities and commitments as well,
    // none of which the checklist reads.
    mocks.rows.set("companies", [{ name: "Acme" }]);
    mocks.rows.set("profiles", []);

    await loadSetupFacts("co_1");

    expect([...new Set(mocks.tablesRead)].sort()).toEqual([
      "companies",
      "profiles",
    ]);
    // Two reads here plus the memoized quarter. Anything that walks
    // the plan cascade or the commitment history has come back.
    expect(mocks.tablesRead).toHaveLength(2);
  });

  it("scopes the roster the same way the dashboard does", async () => {
    // Two checklist steps depend on this predicate: "Build the team"
    // counts the roster, "Invite the team" compares invited against
    // invitable. If it drifts from getDashboardData's
    // (company_id, status <> 'inactive', pending users included), a
    // step starts ticking at a different moment on /scorecard than
    // the same population does on /dashboard, and nothing says so.
    //
    // Asserted against the source, because the chain stub above
    // passes every filter through and cannot observe them without
    // re-implementing PostgREST.
    const source = readFileSync(
      path.resolve(__dirname, "setup-steps.ts"),
      "utf8"
    );
    const rosterRead = source.match(
      /\.from\("profiles"\)[\s\S]*?\.neq\("status", "inactive"\)/
    );

    expect(rosterRead).not.toBeNull();
    expect(rosterRead?.[0]).toContain('.eq("company_id", companyId)');
    // No status filter beyond excluding inactive: pending users count
    // toward the roster on both surfaces.
    expect(rosterRead?.[0]).not.toContain('"pending"');
  });
});
