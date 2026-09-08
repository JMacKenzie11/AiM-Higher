import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  summarizeFollowThrough,
  summarizeFollowThroughCounts,
  type FollowThroughRow,
} from "@/lib/commitments/follow-through";

// /admin/companies stops shipping every commitment on the instance to
// Node to count them.
//
// The old read selected every commitment for every visible company —
// no date bound, no limit — and reduced them in memory to one
// percentage each. For a system_admin that is the whole table. These
// tests hold two things still: the read is now one row per company,
// and the number it produces is the same number.

const TODAY = "2026-09-08";

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
      Object.assign(chain, {
        select: pass,
        eq: pass,
        neq: pass,
        in: pass,
        is: pass,
        order: pass,
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: mocks.rows.get(table) ?? [] }).then(resolve),
      });
      return chain;
    },
  }),
}));

beforeEach(() => {
  mocks.rows.clear();
  mocks.tablesRead.length = 0;
  mocks.rows.set("companies", [
    { id: "co_1", name: "Acme" },
    { id: "co_2", name: "Beta" },
  ]);
  mocks.rows.set("profiles", [{ company_id: "co_1" }]);
  mocks.rows.set("quarters", []);
  mocks.rows.set("company_follow_through", []);
});

describe("getCompaniesOverview — the read is bounded", () => {
  it("reads the per-company aggregate and never the commitments table", async () => {
    // The regression guard. If someone reinstates the fetch-and-reduce,
    // `commitments` reappears here and this fails. It is the only
    // signal: the numbers would still be right, and only the volume
    // would change.
    mocks.rows.set("company_follow_through", [
      {
        company_id: "co_1",
        kept_on_time: 3,
        kept_late: 1,
        missed: 1,
        overdue_open: 1,
      },
    ]);
    const { getCompaniesOverview } = await import("./companies-service");

    await getCompaniesOverview();

    expect(mocks.tablesRead).toContain("company_follow_through");
    expect(mocks.tablesRead).not.toContain("commitments");
  });

  it("returns null, not zero, for a company the aggregate has no row for", async () => {
    // The view emits nothing for a company with no countable
    // commitments. Null is "no data"; zero is "nothing landed on
    // time". Conflating them would put a red 0% against every new
    // tenant on the fleet list.
    const { getCompaniesOverview } = await import("./companies-service");

    const overview = await getCompaniesOverview();

    expect(overview.map((c) => c.keepRate)).toEqual([null, null]);
  });

  it("maps each company to its own counts", async () => {
    mocks.rows.set("company_follow_through", [
      { company_id: "co_2", kept_on_time: 1, kept_late: 0, missed: 1, overdue_open: 0 },
      { company_id: "co_1", kept_on_time: 3, kept_late: 0, missed: 1, overdue_open: 0 },
    ]);
    const { getCompaniesOverview } = await import("./companies-service");

    const byName = new Map(
      (await getCompaniesOverview()).map((c) => [c.name, c.keepRate])
    );

    expect(byName.get("Acme")).toBe(75);
    expect(byName.get("Beta")).toBe(50);
  });
});

describe("the aggregate produces the same number as counting rows", () => {
  // The equivalence that makes this a scheduling change rather than a
  // semantic one. Each fixture is run through BOTH entry points: the
  // row-based summarizeFollowThrough the rest of the product uses, and
  // the counts-based path the view feeds.
  const cases: Array<{ name: string; rows: FollowThroughRow[] }> = [
    {
      name: "a mix of every bucket",
      rows: [
        { status: "kept_on_time", due_date: "2026-09-01" },
        { status: "kept_on_time", due_date: "2026-09-02" },
        { status: "kept_late", due_date: "2026-09-01" },
        { status: "missed", due_date: "2026-09-01" },
        { status: "open", due_date: "2026-09-01" }, // past due, counts
        { status: "open", due_date: "2026-09-30" }, // not due, excluded
      ],
    },
    {
      name: "a commitment due today, which is not late today",
      rows: [
        { status: "kept_on_time", due_date: "2026-09-01" },
        { status: "open", due_date: TODAY },
      ],
    },
    {
      name: "an open commitment with no due date at all",
      rows: [
        { status: "kept_on_time", due_date: "2026-09-01" },
        { status: "open", due_date: null },
      ],
    },
    { name: "nothing to judge", rows: [] },
    {
      name: "nothing landed on time",
      rows: [
        { status: "missed", due_date: "2026-09-01" },
        { status: "kept_late", due_date: "2026-09-01" },
      ],
    },
  ];

  it.each(cases)("$name", ({ rows }) => {
    const fromRows = summarizeFollowThrough(rows, TODAY);

    // Counted the way the SQL counts: filtered aggregates over the
    // same four predicates, including the strict past-due comparison
    // and the null-due-date exclusion.
    const fromCounts = summarizeFollowThroughCounts({
      keptOnTime: rows.filter((r) => r.status === "kept_on_time").length,
      keptLate: rows.filter((r) => r.status === "kept_late").length,
      missed: rows.filter((r) => r.status === "missed").length,
      overdueOpen: rows.filter(
        (r) => r.status === "open" && r.due_date !== null && r.due_date < TODAY
      ).length,
    });

    expect(fromCounts).toEqual(fromRows);
  });
});

describe("migration 0174 (source guard)", () => {
  // No Postgres here, so the SQL is read rather than run — the same
  // approach as rls-privileges.test.ts. It cannot prove the view
  // returns the right rows; it does prove nobody has removed the
  // clauses that make it bounded, tenant-safe, and equal to the
  // in-app rule.
  const sql = readFileSync(
    path.resolve(
      __dirname,
      "../../../supabase/migrations/0174_company_follow_through.sql"
    ),
    "utf8"
  )
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  it("groups by company, so the result is one row per company", () => {
    // The boundedness itself. Lose this and the view returns a row per
    // commitment and we are back where we started, with the service
    // none the wiser.
    expect(sql).toMatch(/group by c\.company_id/i);
  });

  it("is security_invoker, so RLS still scopes the rows it groups", () => {
    // Without it the view runs as its owner and aggregates every
    // tenant's commitments for every caller. That is a cross-tenant
    // read, not a slow page.
    expect(sql).toMatch(
      /alter view public\.company_follow_through set \(security_invoker = on\)/i
    );
  });

  it("counts the same four buckets as follow-through.ts", () => {
    expect(sql).toMatch(/filter \(where c\.status = 'kept_on_time'\)/i);
    expect(sql).toMatch(/filter \(where c\.status = 'kept_late'\)/i);
    expect(sql).toMatch(/filter \(where c\.status = 'missed'\)/i);
    expect(sql).toMatch(/c\.status = 'open'/i);
  });

  it("excludes soft-deleted and parked rows", () => {
    expect(sql).toMatch(/c\.deleted_at is null/i);
    expect(sql).toMatch(/c\.parked_at is null/i);
  });

  it("treats past-due strictly and ignores a missing due date", () => {
    // A commitment due today is not late today — the same rule
    // summarizeFollowThrough applies with `<`, not `<=`.
    expect(sql).toMatch(/c\.due_date < \(now\(\) at time zone 'utc'\)::date/i);
    expect(sql).toMatch(/c\.due_date is not null/i);
    expect(sql).not.toMatch(/due_date <= /i);
  });

  it("judges the clock in UTC, independent of the database's timezone", () => {
    // A cross-tenant list spanning timezones has no single company
    // clock to use. The app used todayInTimezone("UTC") for the same
    // reason, and `now() at time zone 'utc'` reproduces it without
    // depending on the server's own setting.
    expect(sql).toMatch(/now\(\) at time zone 'utc'/i);
    expect(sql).not.toMatch(/\bcurrent_date\b/i);
  });
});
