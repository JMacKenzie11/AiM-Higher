import { describe, it, expect } from "vitest";
import {
  BATCHES,
  NOT_DISTINCT_ALLOWLIST,
  afterPlanIsHoisted,
  batchSummaryLines,
  canaryPresent,
  cloneLag,
  companyOfRowSql,
  describeOutcome,
  fillProbe,
  findBatch,
  grantSummaryLines,
  isolationSql,
  notDistinctMatches,
  notDistinctOffenders,
  otherCompanySql,
  parseArgs,
  planFacts,
  probeVerdict,
  projectRef,
  summaryLines,
  type BatchCheck,
  type CaseResult,
  type GrantProbe,
  type PolicyRow,
  portfolioWriteOffenders,
  portfolioWritePolicies,
} from "./rls-harness.ts";

// The pure halves of the RLS harness. The cases themselves need a real
// Postgres and are run by name (`npm run rls:hazards`), reported in the
// PR body rather than gated in CI — see the header of rls-harness.ts.
//
// Importing this file is itself a test of the entry-point guard: the
// harness creates tables and policies, and without the guard this
// import would run it. scripts/entry-points.test.ts is the gate.

describe("projectRef", () => {
  it("extracts the ref from a Supabase URL", () => {
    expect(projectRef("https://abcdefghijkl.supabase.co")).toBe("abcdefghijkl");
  });

  it("returns null for anything else, so the caller refuses rather than guesses", () => {
    expect(projectRef(undefined)).toBeNull();
    expect(projectRef("")).toBeNull();
    expect(projectRef("postgresql://host/db")).toBeNull();
    expect(projectRef("https://example.com")).toBeNull();
  });
});

describe("parseArgs", () => {
  it("runs every case and skips the measurement by default", () => {
    expect(parseArgs([])).toEqual({
      only: null,
      explain: false,
      batch: null,
      pending: null,
    });
  });

  it("reads --case and --explain", () => {
    expect(parseArgs(["--case", "hazard-1", "--explain"])).toEqual({
      only: "hazard-1",
      explain: true,
      batch: null,
      pending: null,
    });
  });

  it("reads --batch", () => {
    expect(parseArgs(["--batch", "1"])).toEqual({
      only: null,
      explain: false,
      batch: "1",
      pending: null,
    });
  });

  it("reads --pending", () => {
    expect(parseArgs(["--pending", "0176_company_industry_grant.sql"])).toEqual({
      only: null,
      explain: false,
      batch: null,
      pending: "0176_company_industry_grant.sql",
    });
  });

  it("rejects a batch that is not defined rather than measuring nothing", () => {
    // A typo'd batch number that parsed would run zero tables and
    // report a clean pass, which is the same output as a batch that
    // is genuinely fine.
    expect(() => parseArgs(["--batch", "9"])).toThrow();
  });

  it("rejects an unknown option rather than ignoring it", () => {
    expect(() => parseArgs(["--cases"])).toThrow();
  });
});

describe("planFacts", () => {
  const before = [
    "Aggregate (actual time=1.2..1.2 rows=1 loops=1)",
    "  ->  Seq Scan on companies (actual time=0.1..1.0 rows=12 loops=12)",
    "        Filter: EXISTS(SubPlan 1)",
    "        SubPlan 1",
    "          ->  Function Scan on auth_profile ap (actual time=0.0..0.0 rows=1 loops=12)",
    "Execution Time: 2.783 ms",
  ].join("\n");

  const after = [
    "Aggregate (actual time=0.4..0.4 rows=1 loops=1)",
    "  InitPlan 1 (returns $0)",
    "    ->  Result (actual time=0.0..0.0 rows=1 loops=1)",
    "  ->  Seq Scan on companies (actual time=0.1..0.2 rows=12 loops=1)",
    "        Filter: (((InitPlan 1).col1 = 'system_admin'::text) OR ((InitPlan 2).col1 = id))",
    "Execution Time: 1.507 ms",
  ].join("\n");

  it("reads the per-row helper evaluation out of an un-hoisted plan", () => {
    const f = planFacts(before);
    expect(f.initPlan).toBe(false);
    expect(f.loops).toBe("12");
    expect(f.subPlans).toBe(2);
    expect(f.ms).toBe("2.783");
    expect(f.filter).toContain("EXISTS(SubPlan 1)");
  });

  it("reports the helper as absent when it is inside a wrapper function", () => {
    // The hoisted shape calls auth_role()/auth_company_id(), so
    // auth_profile does not appear in the plan at all. "not in plan"
    // has to be distinguishable from loops=0, which never happens.
    const f = planFacts(after);
    expect(f.initPlan).toBe(true);
    expect(f.loops).toBe("not in plan");
  });
});

describe("afterPlanIsHoisted", () => {
  const facts = (over: Partial<ReturnType<typeof planFacts>>) => ({
    initPlan: true,
    loops: "not in plan",
    ms: "1.0",
    filter: null,
    subPlans: 0,
    ...over,
  });

  it("accepts the wrapper form and the inline scalar form", () => {
    expect(afterPlanIsHoisted(facts({}))).toBe(true);
    expect(afterPlanIsHoisted(facts({ loops: "1" }))).toBe(true);
  });

  it("refuses a plan with no InitPlan, however few the loops", () => {
    // The bare-wrapper form (C in the measurement) shows no InitPlan
    // and no auth_profile, and is 374x slower than the status quo. A
    // check that only looked for the absence of loops would pass it.
    expect(afterPlanIsHoisted(facts({ initPlan: false }))).toBe(false);
  });

  it("refuses a plan that still evaluates the helper per row", () => {
    expect(afterPlanIsHoisted(facts({ loops: "5000" }))).toBe(false);
  });
});

describe("notDistinctOffenders", () => {
  const row = (over: Partial<PolicyRow>): PolicyRow => ({
    tablename: "quarters",
    policyname: "quarters_select",
    qual: null,
    with_check: null,
    ...over,
  });

  // THE SPELLING THAT MATTERS. pg_policies does not return the text
  // anyone typed — Postgres stores a parse tree and renders it back,
  // turning `a is not distinct from b` into `NOT (a IS DISTINCT FROM
  // b)`. This is the exact string the live database returned for
  // profiles_update_self, pasted rather than paraphrased, because the
  // first version of this check matched the source spelling, found
  // nothing on a real schema, and went green.
  const DEPARSED =
    "((id = auth.uid()) AND (NOT (company_id IS DISTINCT FROM ( SELECT ap.company_id\n   FROM auth_profile() ap(uid, company_id, role)))))";

  it("matches the deparsed form pg_policies actually returns", () => {
    expect(
      notDistinctOffenders([row({ with_check: DEPARSED })])
    ).toEqual(["quarters.quarters_select"]);
  });

  it("matches the source spelling too", () => {
    expect(
      notDistinctOffenders([
        row({ qual: "(auth_company_id() IS NOT DISTINCT FROM company_id)" }),
      ])
    ).toEqual(["quarters.quarters_select"]);
  });

  it("matches the bare form, which is equally wrong in a tenant predicate", () => {
    // `company_id IS DISTINCT FROM <caller>` admits every row
    // belonging to somebody else.
    expect(
      notDistinctOffenders([row({ qual: "(company_id IS DISTINCT FROM x)" })])
    ).toHaveLength(1);
  });

  it("finds it in with_check as well as using", () => {
    expect(
      notDistinctOffenders([
        row({ with_check: "(x is not distinct from company_id)" }),
      ])
    ).toHaveLength(1);
  });

  it("passes the one policy that legitimately compares NULL to NULL", () => {
    expect(
      notDistinctOffenders([
        row({
          tablename: "profiles",
          policyname: "profiles_update_self",
          with_check: DEPARSED,
        }),
      ])
    ).toEqual([]);
    expect(NOT_DISTINCT_ALLOWLIST).toContain("profiles.profiles_update_self");
  });

  it("says nothing about policies that do not use the idiom", () => {
    expect(notDistinctOffenders([row({ qual: "(x = company_id)" })])).toEqual([]);
  });
});

describe("canaryPresent", () => {
  it("is false when the matcher found nothing at all", () => {
    // A matcher that matches nothing looks exactly like a clean
    // schema. The allowlisted policy is known to use the idiom, so
    // its absence from the matches means the instrument is broken —
    // which is how the deparsing bug above was caught.
    expect(canaryPresent([])).toBe(false);
  });

  it("is false when only non-allowlisted policies matched", () => {
    expect(canaryPresent(["quarters.quarters_select"])).toBe(false);
  });

  it("is true once an allowlisted policy is among the matches", () => {
    expect(canaryPresent(["profiles.profiles_update_self"])).toBe(true);
  });
});

describe("notDistinctMatches", () => {
  it("reports allowlisted and offending policies alike", () => {
    const rows: PolicyRow[] = [
      {
        tablename: "profiles",
        policyname: "profiles_update_self",
        qual: null,
        with_check: "NOT (company_id IS DISTINCT FROM x)",
      },
      {
        tablename: "quarters",
        policyname: "quarters_select",
        qual: "NOT (company_id IS DISTINCT FROM x)",
        with_check: null,
      },
    ];
    expect(notDistinctMatches(rows)).toEqual([
      "profiles.profiles_update_self",
      "quarters.quarters_select",
    ]);
    expect(notDistinctOffenders(rows)).toEqual(["quarters.quarters_select"]);
  });
});

describe("BATCHES", () => {
  it("knows batch 1 and the migration its measurements are taken with", () => {
    const b = findBatch("1");
    expect(b?.tables).toEqual(["companies", "company_features", "quarters"]);
    expect(b?.migration).toMatch(/^\d{4}_.*\.sql$/);
  });

  it("returns null for a batch that has not been written yet", () => {
    expect(findBatch("6")).toBeNull();
  });

  it("gives every batch a distinct number", () => {
    const ns = BATCHES.map((b) => b.n);
    expect(new Set(ns).size).toBe(ns.length);
  });
});

describe("batchSummaryLines", () => {
  const check: BatchCheck = {
    name: "isolation · quarters",
    before: "own 3, other 0",
    after: "own 3, other 0",
    ok: true,
    detail: "reads its own company, denied the other",
  };

  it("shows before and after on every check, not just the verdict", () => {
    const out = batchSummaryLines([check], "Batch 1 acceptance").join("\n");
    expect(out).toContain("before: own 3, other 0");
    expect(out).toContain("after:  own 3, other 0");
    expect(out).toContain("Batch 1 acceptance");
  });

  it("counts passes and failures", () => {
    const out = batchSummaryLines([check, { ...check, ok: false }], "x").join("\n");
    expect(out).toContain("2 checks: 1 pass, 1 fail");
  });
});

describe("summaryLines", () => {
  const pass: CaseResult = {
    name: "hazard-1 null-company",
    hazard: "IS NOT DISTINCT FROM matches NULL to NULL",
    wrong: "1 row(s) visible",
    right: "0 row(s) visible",
    ok: true,
    detail: "wrong shape leaks, right shape denies",
  };

  it("shows both shapes on every case, not just the verdict", () => {
    // A case that reported only PASS would hide the thing that makes it
    // meaningful: that the deliberately-wrong policy actually leaked.
    // If the wrong shape ever stops leaking, the case has stopped
    // testing anything and the reader has to be able to see it.
    const out = summaryLines([pass]).join("\n");
    expect(out).toContain("wrong shape: 1 row(s) visible");
    expect(out).toContain("right shape: 0 row(s) visible");
  });

  it("counts passes and failures", () => {
    const out = summaryLines([pass, { ...pass, ok: false }]).join("\n");
    expect(out).toContain("2 cases: 1 pass, 1 fail");
  });
});

describe("describeOutcome", () => {
  // The three ways a write ends have to stay distinguishable. RLS
  // refuses an UPDATE by matching no rows; the column guard refuses
  // one by raising; success writes rows. A probe that collapsed the
  // first two would call a broken grant "correctly scoped".
  it("reads a successful write", () => {
    expect(describeOutcome([{ id: "x" }])).toBe("1 row(s) written");
  });

  it("reads an RLS denial, which is zero rows and no error", () => {
    expect(describeOutcome([])).toBe("0 rows (refused by RLS)");
  });

  it("reads the column guard's raise as its own outcome", () => {
    expect(
      describeOutcome(null, new Error('Only industry may be changed on a company by a company_admin'))
    ).toBe("refused by the column guard");
  });

  it("reads an RLS insert violation", () => {
    expect(
      describeOutcome(null, new Error("new row violates row-level security policy"))
    ).toBe("refused by RLS");
  });

  it("keeps an unexpected error visible rather than calling it a denial", () => {
    // An error the probe does not recognise must not be reported as a
    // refusal: a typo'd column name would otherwise read as "the
    // grant is correctly scoped".
    expect(describeOutcome(null, new Error('column "industy" does not exist'))).toMatch(
      /^ERROR: /
    );
  });
});

describe("grantSummaryLines", () => {
  const probe: GrantProbe = {
    name: "industry grant · company_admin",
    granted: "industry on own company: 1 row(s) written",
    withheld: "status on own company: refused by the column guard",
    ok: true,
    detail: "can set industry where entitled, and nothing else",
  };

  it("shows both halves of every grant, not just the success", () => {
    // "The update succeeded" is equally true of a correct narrow
    // grant and of a policy that admits everything.
    const out = grantSummaryLines([probe]).join("\n");
    expect(out).toContain("granted:  industry on own company: 1 row(s) written");
    expect(out).toContain("withheld: status on own company: refused by the column guard");
  });

  it("counts passes and failures", () => {
    const out = grantSummaryLines([probe, { ...probe, ok: false }]).join("\n");
    expect(out).toContain("2 probes: 1 pass, 1 fail");
  });
});

// ---- Isolation scope -------------------------------------------
//
// Batch 2 brought the first table with no company_id of its own, and
// with it two bugs worth pinning: a helper that assumed every table
// has an `id` (company_features does not, and it is already
// deployed), and an isolation check that read "0 rows of company B"
// as a denial when company B had no rows at all.

const DIRECT = { n: "d", tables: ["commitments"], migration: "m.sql" };
const COMPANIES = { n: "c", tables: ["companies"], migration: "m.sql" };
const FEATURES = { n: "f", tables: ["company_features"], migration: "m.sql" };
const INDIRECT = {
  n: "i",
  tables: ["commitment_occurrences"],
  migration: "m.sql",
  indirectScope: {
    commitment_occurrences: {
      key: "id",
      rows:
        "select o.id as key, c.company_id from public.commitment_occurrences o " +
        "join public.commitments c on c.id = o.commitment_id",
    },
  },
};

describe("companyOfRowSql", () => {
  it("treats a company as its own company", () => {
    expect(companyOfRowSql(COMPANIES, "companies")).toBe(
      "select id as company_id from public.companies"
    );
  });

  it("names the column for an ordinary table", () => {
    expect(companyOfRowSql(DIRECT, "commitments")).toBe(
      "select company_id from public.commitments"
    );
  });

  // The regression: company_features has no id column, and a helper
  // that selected one broke the batch that is already in production.
  it("does not require an id column", () => {
    for (const sql of [
      companyOfRowSql(FEATURES, "company_features"),
      companyOfRowSql(COMPANIES, "companies"),
      companyOfRowSql(INDIRECT, "commitment_occurrences"),
    ]) {
      expect(sql).not.toMatch(/select\s+id\s*,/);
    }
  });

  it("traverses to the parent for a table with no company of its own", () => {
    expect(companyOfRowSql(INDIRECT, "commitment_occurrences")).toContain(
      "join public.commitments c on c.id = o.commitment_id"
    );
  });
});

// csf_kpi_links is keyed (csf_id, kpi_id) and company_features has no
// id either. A traversal that assumed one broke batch 1 once already.
describe("a table with no id column", () => {
  const COMPOSITE = {
    n: "k",
    tables: ["csf_kpi_links"],
    migration: "m.sql",
    indirectScope: {
      csf_kpi_links: {
        key: "(csf_id::text || ':' || kpi_id::text)",
        rows:
          "select (l.csf_id::text || ':' || l.kpi_id::text) as key, f.company_id " +
          "from public.csf_kpi_links l " +
          "join public.success_measures m on m.id = l.csf_id " +
          "join public.functions f on f.id = m.function_id",
      },
    },
  };

  it("keys the scope sets by the composite expression", () => {
    const { setup, assertion } = isolationSql(COMPOSITE, "csf_kpi_links", "A", "B");
    expect(setup).toContain("select key from (select (l.csf_id::text");
    expect(assertion).toContain("(csf_id::text || ':' || kpi_id::text) in (select key from _scope_own)");
  });

  it("never selects a bare id", () => {
    const { setup, assertion } = isolationSql(COMPOSITE, "csf_kpi_links", "A", "B");
    expect(setup + assertion).not.toMatch(/select\s+id\b/);
  });
});

describe("otherCompanySql", () => {
  it("excludes the caller's own company", () => {
    expect(otherCompanySql(DIRECT, "commitments", "A")).toContain(
      "company_id <> 'A'"
    );
  });

  it("ignores rows with no company, which cannot belong to another tenant", () => {
    expect(otherCompanySql(DIRECT, "commitments", "A")).toContain(
      "company_id is not null"
    );
  });

  it("returns the count too, so the check can refuse to read an empty set as a denial", () => {
    expect(otherCompanySql(DIRECT, "commitments", "A")).toContain("count(*)::int as n");
  });

  it("picks the company with the most rows, so the denial is measured against the largest set available", () => {
    expect(otherCompanySql(DIRECT, "commitments", "A")).toContain(
      "order by count(*) desc limit 1"
    );
  });
});

describe("isolationSql", () => {
  it("keys companies by id", () => {
    const { setup, assertion } = isolationSql(COMPANIES, "companies", "A", "B");
    expect(setup).toBe("");
    expect(assertion).toContain("where id = 'A'");
    expect(assertion).toContain("where id = 'B'");
  });

  it("keys an ordinary table by company_id, with no setup", () => {
    const { setup, assertion } = isolationSql(DIRECT, "commitments", "A", "B");
    expect(setup).toBe("");
    expect(assertion).toContain("where company_id = 'A'");
    expect(assertion).toContain("where company_id = 'B'");
  });

  it("materialises both scope sets for an indirect table", () => {
    const { setup } = isolationSql(INDIRECT, "commitment_occurrences", "A", "B");
    expect(setup).toContain("create temp table _scope_own");
    expect(setup).toContain("create temp table _scope_other");
    expect(setup).toContain("where company_id = 'A'");
    expect(setup).toContain("where company_id = 'B'");
  });

  it("grants the scope sets to authenticated, or the caller cannot read them", () => {
    const { setup } = isolationSql(INDIRECT, "commitment_occurrences", "A", "B");
    expect(setup).toContain(
      "grant select on _scope_own, _scope_other to authenticated"
    );
  });

  it("counts the caller's visible rows within each set, not the set itself", () => {
    const { assertion } = isolationSql(INDIRECT, "commitment_occurrences", "A", "B");
    expect(assertion).toContain(
      "from public.commitment_occurrences where id in (select key from _scope_own)"
    );
  });

  it("reports both halves, whichever path, so a zero is never read alone", () => {
    for (const batch of [DIRECT, INDIRECT]) {
      const { assertion } = isolationSql(batch, batch.tables[0], "A", "B");
      expect(assertion).toContain("as own");
      expect(assertion).toContain("as other_");
    }
  });
});

describe("BATCHES", () => {
  it("registers batch 2 against the migration that carries it", () => {
    const b = findBatch("2");
    expect(b?.tables).toEqual(["commitments", "commitment_occurrences"]);
    expect(b?.migration).toBe("0177_f8_batch2_hoist.sql");
  });

  it("declares the traversal for the table with no company_id", () => {
    expect(findBatch("2")?.indirectScope?.commitment_occurrences?.rows).toContain(
      "join public.commitments"
    );
  });
});

// ---- Write probes ----------------------------------------------
//
// Both of these exist because of mistakes made while writing the
// probes by hand: a column that did not exist, and a fixture row
// owned by a different member. Each produced a confident `0 row(s)`
// that would have read as enforcement.

describe("fillProbe", () => {
  it("substitutes every placeholder", () => {
    const { sql, missing } = fillProbe("delete where id = '$own_open'", {
      own_open: "abc",
    });
    expect(sql).toBe("delete where id = 'abc'");
    expect(missing).toEqual([]);
  });

  it("names a placeholder the fixtures could not fill", () => {
    const { missing } = fillProbe("id = '$own_occurrence'", {
      own_occurrence: null,
    });
    expect(missing).toEqual(["own_occurrence"]);
  });

  it("treats an absent key as missing, not as empty", () => {
    expect(fillProbe("id = '$nope'", {}).missing).toEqual(["nope"]);
  });

  it("reports every missing placeholder, not just the first", () => {
    const { missing } = fillProbe("'$a' and '$b'", { a: null, b: null });
    expect(missing).toEqual(["a", "b"]);
  });
});

describe("probeVerdict", () => {
  it("passes when before and after match the expectation", () => {
    expect(probeVerdict({ before: "1", after: "1", expect: "1" }).ok).toBe(true);
  });

  it("fails loudly when before and after disagree", () => {
    const v = probeVerdict({ before: "1", after: "0", expect: "1" });
    expect(v.ok).toBe(false);
    expect(v.detail).toContain("SEMANTICS MOVED");
  });

  it("fails when both agree on the wrong answer", () => {
    const v = probeVerdict({ before: "0", after: "0", expect: "1" });
    expect(v.ok).toBe(false);
    expect(v.detail).toContain("expected 1");
  });

  // The empty-set rule, on the write side.
  it("refuses a zero the control caller also got", () => {
    const v = probeVerdict({ before: "0", after: "0", expect: "0", control: "0" });
    expect(v.ok).toBe(false);
    expect(v.detail).toContain("NOT PROVEN");
  });

  it("accepts a zero the control caller did not get", () => {
    const v = probeVerdict({ before: "0", after: "0", expect: "0", control: "1" });
    expect(v.ok).toBe(true);
    expect(v.detail).toContain("control caller got 1");
  });

  it("compares an error code like any other answer", () => {
    expect(
      probeVerdict({ before: "42501", after: "42501", expect: "42501" }).ok
    ).toBe(true);
    expect(
      probeVerdict({ before: "42501", after: "0", expect: "42501" }).ok
    ).toBe(false);
  });
});

// ---- cloneLag ---------------------------------------------------
//
// The clone sat eight migrations behind the fleet for a whole
// afternoon and nothing said so. These pin the arithmetic; the gate
// that uses it is in main().

describe("cloneLag", () => {
  const LOCAL = ["0179_a.sql", "0180_b.sql", "0181_c.sql", "0182_d.sql"];

  it("reports nothing behind when the clone matches the newest", () => {
    const lag = cloneLag({ cloneHead: "0182", localMigrations: LOCAL });
    expect(lag.behind).toEqual([]);
    expect(lag.newest).toBe("0182");
  });

  it("names every migration the clone is missing", () => {
    expect(cloneLag({ cloneHead: "0180", localMigrations: LOCAL }).behind).toEqual([
      "0181",
      "0182",
    ]);
  });

  it("treats a clone with no migration history as behind everything", () => {
    expect(cloneLag({ cloneHead: null, localMigrations: LOCAL }).behind).toEqual([
      "0179",
      "0180",
      "0181",
      "0182",
    ]);
  });

  it("is not confused by a clone ahead of the repo", () => {
    // A refreshed clone can carry migrations this checkout does not
    // have yet. That is not staleness and must not read as it.
    expect(cloneLag({ cloneHead: "0190", localMigrations: LOCAL }).behind).toEqual([]);
  });

  it("ignores files that are not versioned migrations", () => {
    const lag = cloneLag({
      cloneHead: "0180",
      localMigrations: ["README.md", "notes.sql", "0181_c.sql"],
    });
    expect(lag.behind).toEqual(["0181"]);
    expect(lag.newest).toBe("0181");
  });

  it("compares as strings in a zero-padded scheme, so 0099 precedes 0100", () => {
    expect(
      cloneLag({ cloneHead: "0099", localMigrations: ["0099_a.sql", "0100_b.sql"] }).behind
    ).toEqual(["0100"]);
  });
});

// ---- portfolio_admin write allowlist ---------------------------
//
// The closed list, as a matcher. These are the cases the live check
// cannot exercise: a policy spelled the other way, a SELECT policy
// that must NOT count, and an offender on a table nobody probed.
describe("portfolioWriteOffenders", () => {
  const row = (
    tablename: string,
    policyname: string,
    cmd: string,
    body: string
  ): PolicyRow => ({
    tablename,
    policyname,
    cmd,
    qual: body,
    with_check: null,
  });

  const HELPER = "(select public.is_portfolio_admin())";
  const LITERAL = "(select auth_role()) = 'portfolio_admin'";

  it("accepts the four allowlisted tables", () => {
    const rows = [
      row("companies", "companies_insert_portfolio", "INSERT", HELPER),
      row("company_features", "cf_insert_portfolio", "INSERT", HELPER),
      row("profiles", "profiles_insert_portfolio", "INSERT", HELPER),
      row("portfolio_admin_events", "pae_insert", "INSERT", HELPER),
    ];
    expect(portfolioWriteOffenders(rows)).toEqual([]);
    expect(portfolioWritePolicies(rows)).toHaveLength(4);
  });

  it("catches a content grant written with the helper", () => {
    const rows = [row("commitments", "c_update_portfolio", "UPDATE", HELPER)];
    expect(portfolioWriteOffenders(rows)).toEqual([
      "commitments.c_update_portfolio",
    ]);
  });

  it("catches a content grant written as a bare role comparison", () => {
    // The spelling somebody reaches for when they are in a hurry. A
    // matcher that only knew the helper would call this clean.
    const rows = [row("issues", "i_insert_portfolio", "INSERT", LITERAL)];
    expect(portfolioWriteOffenders(rows)).toEqual(["issues.i_insert_portfolio"]);
  });

  it("ignores SELECT policies, which are the point of the role", () => {
    // 0191 is forty-nine of these. If they counted, the check would
    // fail on the read grant it exists alongside.
    const rows = [row("commitments", "c_select_portfolio", "SELECT", HELPER)];
    expect(portfolioWritePolicies(rows)).toEqual([]);
    expect(portfolioWriteOffenders(rows)).toEqual([]);
  });

  it("ignores write policies that do not name the role at all", () => {
    const rows = [
      row("commitments", "c_update", "UPDATE", "(select auth_role()) = 'system_admin'"),
    ];
    expect(portfolioWritePolicies(rows)).toEqual([]);
  });

  it("reads the role out of with_check as well as qual", () => {
    // An INSERT policy has no USING clause at all, so a matcher that
    // only read `qual` would be blind to every insert grant — which
    // is most of this role's write surface.
    const rows: PolicyRow[] = [
      {
        tablename: "priorities",
        policyname: "p_insert_portfolio",
        cmd: "INSERT",
        qual: null,
        with_check: HELPER,
      },
    ];
    expect(portfolioWriteOffenders(rows)).toEqual([
      "priorities.p_insert_portfolio",
    ]);
  });

  it("treats a row with no cmd as a SELECT rather than guessing", () => {
    // The pure matchers are also fed hand-made rows with no command.
    // Defaulting to SELECT means such a row can never be reported as
    // an offender on the strength of a field that was not supplied.
    const rows: PolicyRow[] = [
      {
        tablename: "commitments",
        policyname: "mystery",
        qual: HELPER,
        with_check: null,
      },
    ];
    expect(portfolioWritePolicies(rows)).toEqual([]);
  });
});

describe("cloneLag with --pending", () => {
  it("does not count a migration this run applies per-transaction", () => {
    // A batch's own migrations are unlanded by definition. Counting
    // them would make the gate refuse the run it exists to protect.
    const lag = cloneLag({
      cloneHead: "0189",
      localMigrations: ["0189_x.sql", "0190_y.sql", "0191_z.sql"],
      pending: ["0190_y.sql", "0191_z.sql"],
    });
    expect(lag.behind).toEqual([]);
    expect(lag.newest).toBe("0191");
  });

  it("still catches one that is neither deployed nor pending", () => {
    const lag = cloneLag({
      cloneHead: "0189",
      localMigrations: ["0190_y.sql", "0191_z.sql", "0192_w.sql"],
      pending: ["0190_y.sql"],
    });
    expect(lag.behind).toEqual(["0191", "0192"]);
  });

  it("tolerates whitespace around a comma-separated pending list", () => {
    const lag = cloneLag({
      cloneHead: "0189",
      localMigrations: ["0190_y.sql"],
      pending: [" 0190_y.sql "],
    });
    expect(lag.behind).toEqual([]);
  });
});
