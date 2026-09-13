import { describe, it, expect } from "vitest";
import {
  projectRef,
  summaryLines,
  parseArgs,
  planFacts,
  afterPlanIsHoisted,
  notDistinctOffenders,
  notDistinctMatches,
  canaryPresent,
  batchSummaryLines,
  findBatch,
  BATCHES,
  NOT_DISTINCT_ALLOWLIST,
  type CaseResult,
  type BatchCheck,
  type PolicyRow,
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
    expect(parseArgs([])).toEqual({ only: null, explain: false, batch: null });
  });

  it("reads --case and --explain", () => {
    expect(parseArgs(["--case", "hazard-1", "--explain"])).toEqual({
      only: "hazard-1",
      explain: true,
      batch: null,
    });
  });

  it("reads --batch", () => {
    expect(parseArgs(["--batch", "1"])).toEqual({
      only: null,
      explain: false,
      batch: "1",
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
