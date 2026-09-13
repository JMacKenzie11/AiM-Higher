/**
 * scripts/rls-harness.ts
 *
 * Runs RLS behaviour tests against a real Postgres, as a real caller.
 *
 * Usage:
 *   npm run rls:hazards            # every case, plus the static check
 *   npm run rls:hazards -- --case hazard-1
 *   npm run rls:hazards -- --explain     # also the InitPlan measurement
 *   npm run rls:hazards -- --batch 1     # a batch's acceptance + EXPLAIN pair
 *   npm run rls:hazards -- --pending 0176_x.sql   # probe an undeployed grant
 *
 * --batch is what an F8 batch PR pastes into its body: the deleted-user
 * test against every table in the batch, the isolation acceptance, the
 * nullable-company_id case where it applies, and a before/after EXPLAIN
 * for three caller classes. The batch's migration is applied inside
 * each transaction and rolled back with it, so the pair is measured on
 * the real policies without the clone being modified or the change
 * being deployed anywhere first.
 *
 * WHY THIS EXISTS. `npm test` runs in Node with no database, which is
 * why src/lib/auth/rls-privileges.test.ts reads migration text instead
 * of executing anything. That is the right call for a source guard and
 * useless for the question F8 actually raises: does a rewritten policy
 * still deny? Policy text can look correct and behave differently, and
 * the only thing that settles it is a session with a JWT hitting a
 * real table.
 *
 * NOT IN CI, DELIBERATELY. It needs SUPABASE_MANAGEMENT_TOKEN and it
 * points at a shared dev clone that anyone may refresh out from under
 * it. A gate that a colleague's refresh can turn red is a gate that
 * gets deleted. It is invoked by name and its output is pasted into
 * the PR body, the same way the browser passes are.
 *
 * EVERY CASE ROLLS BACK. Each one runs inside a single
 * `begin; … rollback;` sent as one statement, so the scratch tables,
 * scratch policies and scratch functions it creates never outlive the
 * check. Nothing here writes to an application table.
 *
 * EVERY CASE IS SELF-VALIDATING. A test that only ever sees the right
 * answer proves nothing — failure mode E1 in docs/failure-modes.md is
 * exactly this. So each case installs the WRONG shape and the RIGHT
 * shape side by side on scratch tables and asserts that the wrong one
 * leaks and the right one denies. If a case reports both green, the
 * case itself is broken.
 *
 * A ZERO IS NOT A PASS UNTIL A NONZERO WAS AVAILABLE. Every check
 * here whose pass condition is "0 rows" reports, in the same run, the
 * set that zero was measured against: the deleted-user case names what
 * an ordinary member sees, the isolation case names how many rows the
 * other company actually has. A zero from a working boundary and a
 * zero from an empty table are the same zero. Only one is evidence,
 * and the check cannot tell them apart without the control.
 *
 * It refuses to run against production or the control plane. The
 * target is read from LOCAL_INSTANCE_SUPABASE_URL and checked against
 * PROD_SUPABASE_URL and CONTROL_PLANE_SUPABASE_URL by project ref.
 */

import { readFileSync } from "node:fs";

import { createManagementClient } from "./lib/provisioning/supabase-management.ts";
import { isEntryPoint } from "./lib/entry-point.ts";

for (const file of [".env.local", ".env.provisioning"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // Reported by name below if something is actually missing.
  }
}

function fail(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

export function projectRef(url: string | undefined): string | null {
  return (url ?? "").match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ?? null;
}

// The clone, and only the clone.
//
// Not a warning in the docs — a refusal here. These cases create
// tables and policies, and while every one of them rolls back, a
// transaction that errors on a live database is still a transaction
// that ran on a live database.
export function resolveTarget(env: NodeJS.ProcessEnv): string {
  const clone = projectRef(env.LOCAL_INSTANCE_SUPABASE_URL);
  const prod = projectRef(env.PROD_SUPABASE_URL);
  const control = projectRef(env.CONTROL_PLANE_SUPABASE_URL);

  if (!clone) {
    fail(
      "LOCAL_INSTANCE_SUPABASE_URL is not set. This harness runs against " +
        "the dev clone and nothing else. See docs/e2e.md."
    );
  }
  if (clone === prod || clone === control) {
    fail(
      `LOCAL_INSTANCE_SUPABASE_URL resolves to ${clone}, which is also ` +
        "the production or control-plane project. Refusing to run."
    );
  }
  return clone;
}

export type CaseResult = {
  name: string;
  hazard: string;
  // What the deliberately-wrong policy did. A case is only meaningful
  // if this shows the leak it is meant to catch.
  wrong: string;
  // What the correct policy did.
  right: string;
  ok: boolean;
  detail: string;
};

export function summaryLines(results: CaseResult[]): string[] {
  const lines = [""];
  for (const r of results) {
    lines.push(`  ${(r.ok ? "PASS" : "FAIL").padEnd(6)}${r.name.padEnd(30)}${r.detail}`);
    lines.push(`  ${"".padEnd(6)}${"".padEnd(30)}wrong shape: ${r.wrong}`);
    lines.push(`  ${"".padEnd(6)}${"".padEnd(30)}right shape: ${r.right}`);
  }
  const failed = results.filter((r) => !r.ok).length;
  lines.push("");
  lines.push(
    `  ${results.length} case${results.length === 1 ? "" : "s"}: ` +
      `${results.length - failed} pass, ${failed} fail`
  );
  lines.push("");
  return lines;
}

type Runner = <T>(sql: string) => Promise<T[]>;

// ---- Identities the cases act as -------------------------------
//
// Real profiles, not fixtures. Creating a profile means creating an
// auth.users row to satisfy the foreign key, and a case that has to
// build a user before it can ask a question is a case with more
// surface than the thing it tests.
type Identities = {
  noCompany: string; // a profile whose company_id IS NULL
  systemAdmin: string; // a profile whose role is system_admin
  member: string; // an ordinary member of some company
  memberCompany: string;
  otherCompany: string; // a different company, for the isolation case
  nobody: string; // a uuid with no profile row at all
  companyAdmin: string; // an active company_admin
  companyAdminCompany: string; // the company they administer
  guide: string; // an active aims_guide with at least one assignment
  guideCompany: string; // a company assigned to that guide
};

async function loadIdentities(run: Runner): Promise<Identities> {
  const [row] = await run<{
    no_company: string | null;
    system_admin: string | null;
    company_admin: string | null;
    company_admin_company: string | null;
    guide: string | null;
    guide_company: string | null;
    member: string | null;
    member_company: string | null;
    other_company: string | null;
  }>(`
    select
      (select id from public.profiles
        where company_id is null and status = 'active' limit 1) as no_company,
      (select id from public.profiles
        where role = 'system_admin' and status = 'active' limit 1) as system_admin,
      (select id from public.profiles
        where role = 'company_admin' and status = 'active'
          and company_id is not null limit 1) as company_admin,
      (select company_id from public.profiles
        where role = 'company_admin' and status = 'active'
          and company_id is not null limit 1) as company_admin_company,
      (select ga.guide_id from public.guide_assignments ga
         join public.profiles p on p.id = ga.guide_id
        where p.role = 'aims_guide' and p.status = 'active' limit 1) as guide,
      (select ga.company_id from public.guide_assignments ga
         join public.profiles p on p.id = ga.guide_id
        where p.role = 'aims_guide' and p.status = 'active' limit 1) as guide_company,
      (select id from public.profiles
        where company_id is not null and status = 'active'
          and role = 'team_member' limit 1) as member,
      (select company_id from public.profiles
        where company_id is not null and status = 'active'
          and role = 'team_member' limit 1) as member_company,
      (select c.id from public.companies c
        where c.id <> (select company_id from public.profiles
                        where company_id is not null and status='active'
                          and role='team_member' limit 1) limit 1) as other_company`);

  if (
    !row?.no_company ||
    !row?.system_admin ||
    !row?.company_admin ||
    !row?.company_admin_company ||
    !row?.guide ||
    !row?.guide_company ||
    !row?.member ||
    !row?.member_company ||
    !row?.other_company
  ) {
    fail(
      "The clone does not carry the identities these cases need: a profile " +
        "with a NULL company_id, an active system_admin, an active " +
        "company_admin, an active aims_guide holding at least one " +
        "assignment, an active team_member, and a second company. Run " +
        "`npm run seed:e2e`, or refresh the clone."
    );
  }
  return {
    noCompany: row.no_company,
    systemAdmin: row.system_admin,
    companyAdmin: row.company_admin,
    companyAdminCompany: row.company_admin_company,
    guide: row.guide,
    guideCompany: row.guide_company,
    member: row.member,
    memberCompany: row.member_company,
    otherCompany: row.other_company,
    nobody: "00000000-0000-0000-0000-000000000001",
  };
}

// One transaction, always rolled back.
//
// Setup runs as the connection's own role, BEFORE the switch: creating
// a table is not something `authenticated` may do, and a harness that
// tried would be testing its own privileges rather than the policy.
// Only the assertion runs as the caller.
function asCaller(sub: string, setup: string, assertion: string): string {
  return [
    "begin;",
    setup,
    "set local role authenticated;",
    `set local request.jwt.claims = '{"sub":"${sub}","role":"authenticated"}';`,
    assertion,
    "rollback;",
  ].join("\n");
}

// Scratch table carrying a nullable company_id, plus the two policy
// shapes under comparison. Created as postgres, read as the caller.
function scratch(opts: {
  wrongPredicate: string;
  rightPredicate: string;
  rows: string;
}): string {
  return `
create table _rls_wrong (id int primary key, company_id uuid);
create table _rls_right (id int primary key, company_id uuid);
insert into _rls_wrong values ${opts.rows};
insert into _rls_right values ${opts.rows};
alter table _rls_wrong enable row level security;
alter table _rls_right enable row level security;
create policy p on _rls_wrong for select to authenticated
  using (${opts.wrongPredicate});
create policy p on _rls_right for select to authenticated
  using (${opts.rightPredicate});
grant select on _rls_wrong, _rls_right to authenticated;`;
}

const COUNTS =
  "select (select count(*) from _rls_wrong)::int as wrong, " +
  "(select count(*) from _rls_right)::int as right_;";

// ---- The cases -------------------------------------------------

async function hazard1(run: Runner, ids: Identities): Promise<CaseResult> {
  // IS NOT DISTINCT FROM turns deny into allow when both sides are
  // NULL. The caller has no company (every system_admin and every
  // aims_guide); the row has no company (an unrouted meeting). The
  // guarded EXISTS form these policies use today denies. The idiom
  // 0164 established for profiles_update_self does not.
  const sql = asCaller(
    ids.noCompany,
    scratch({
      wrongPredicate:
        "(select ap.company_id from public.auth_profile() ap) is not distinct from company_id",
      rightPredicate:
        "(select ap.company_id from public.auth_profile() ap) = company_id",
      rows: "(1, null), (2, gen_random_uuid())",
    }),
    COUNTS
  );
  const [r] = await run<{ wrong: number; right_: number }>(sql);
  return {
    name: "hazard-1 null-company",
    hazard: "IS NOT DISTINCT FROM matches NULL to NULL",
    wrong: `${r.wrong} row(s) visible`,
    right: `${r.right_} row(s) visible`,
    ok: r.wrong > 0 && r.right_ === 0,
    detail:
      r.wrong > 0 && r.right_ === 0
        ? "wrong shape leaks the NULL-company row, right shape denies"
        : "CASE IS BROKEN: expected the wrong shape to leak and the right shape to deny",
  };
}

async function hazard2(run: Runner, ids: Identities): Promise<CaseResult> {
  // With no profile row auth_profile() returns zero rows, so EXISTS is
  // false but a scalar subquery is NULL. A bare USING (NULL) denies,
  // so the danger is composition: any surrounding expression that
  // treats NULL as permissive flips it. coalesce(..., true) is the
  // realistic mistake — someone "fixing" a policy that stopped
  // matching.
  const sql = asCaller(
    ids.nobody,
    scratch({
      wrongPredicate:
        "coalesce((select ap.role from public.auth_profile() ap) = 'system_admin', true)",
      rightPredicate:
        "(select ap.role from public.auth_profile() ap) = 'system_admin'",
      rows: "(1, null), (2, gen_random_uuid())",
    }),
    COUNTS
  );
  const [r] = await run<{ wrong: number; right_: number }>(sql);
  return {
    name: "hazard-2 deleted-user",
    hazard: "NULL is not false once the expression is composed",
    wrong: `${r.wrong} row(s) visible`,
    right: `${r.right_} row(s) visible`,
    ok: r.wrong > 0 && r.right_ === 0,
    detail:
      r.wrong > 0 && r.right_ === 0
        ? "a NULL-defaulting composition leaks to a caller with no profile"
        : "CASE IS BROKEN: expected the wrong shape to leak and the right shape to deny",
  };
}

async function hazard3(run: Runner, ids: Identities): Promise<CaseResult> {
  // auth_profile() is set-returning. A scalar subquery over it works
  // only because profiles has a primary key. If that function ever
  // returns two rows, the scalar form RAISES where the EXISTS form
  // returned false — a denial becomes a 500, fleet-wide, on every
  // protected read. The scratch function stands in for that future.
  const twoRows = `
create function _rls_two() returns table (company_id uuid)
  language sql stable as $fn$ select null::uuid union all select null::uuid $fn$;`;

  const probe = async (predicate: string): Promise<string> => {
    try {
      const sql = asCaller(
        ids.member,
        twoRows +
          `
create table _rls_t (id int primary key, company_id uuid);
insert into _rls_t values (1, null);
alter table _rls_t enable row level security;
create policy p on _rls_t for select to authenticated using (${predicate});
grant select on _rls_t to authenticated;`,
        "select (select count(*) from _rls_t)::int as n;"
      );
      const [r] = await run<{ n: number }>(sql);
      return `${r.n} row(s), no error`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return /more than one row/i.test(msg) ? "ERROR: more than one row" : `ERROR: ${msg.slice(0, 60)}`;
    }
  };

  const wrong = await probe("(select company_id from _rls_two()) = company_id");
  const right = await probe("(select company_id from _rls_two() limit 1) = company_id");
  const ok = wrong.startsWith("ERROR: more than one row") && !right.startsWith("ERROR");
  return {
    name: "hazard-3 cardinality",
    hazard: "scalar subquery over a set-returning helper raises",
    wrong,
    right,
    ok,
    detail: ok
      ? "unbounded scalar subquery raises; a scalar-by-construction form does not"
      : "CASE IS BROKEN: expected the unbounded form to raise and the bounded form not to",
  };
}

// ---- The InitPlan measurement ----------------------------------
//
// Not a pass/fail. It answers the question that decides the hoist's
// shape: which form gets `auth_profile()` evaluated ONCE per statement
// rather than once per row?
//
// The predicate below is the REAL policy shape, OR branch and
// IS NOT NULL guard included. That matters more than it looks. A
// simplified `ap.company_id = t.company_id` lets the planner turn the
// EXISTS into a hashed semi-join and evaluate the helper once, which
// would suggest today's form is already fine. It is not: the OR
// against a constant is what blocks that transformation and forces the
// per-row SubPlan seen in the F11 plans (loops=141, loops=270).
async function initPlanMeasurement(run: Runner, ids: Identities): Promise<string[]> {
  const ROWS = 5000;
  const setup = `
create function _auth_company_id() returns uuid
  language sql stable security definer set search_path = public
  as $fn$ select company_id from public.auth_profile() limit 1 $fn$;
create function _auth_role() returns text
  language sql stable security definer set search_path = public
  as $fn$ select role from public.auth_profile() limit 1 $fn$;
create table _rls_m (id int primary key, company_id uuid);
insert into _rls_m
  select g, (select company_id from public.profiles where id = '${ids.member}')
    from generate_series(1, ${ROWS}) g;
alter table _rls_m enable row level security;
grant select on _rls_m to authenticated;
grant execute on function _auth_company_id(), _auth_role() to authenticated;`;

  const variants: Array<[string, string]> = [
    [
      "A exists (today)",
      `exists (select 1 from public.auth_profile() ap
                where ap.role = 'system_admin'
                   or (ap.company_id is not null and ap.company_id = _rls_m.company_id))`,
    ],
    [
      "B inline scalar subquery",
      `(select ap.role from public.auth_profile() ap limit 1) = 'system_admin'
        or (select ap.company_id from public.auth_profile() ap limit 1) = _rls_m.company_id`,
    ],
    [
      "C bare wrapper fn",
      `_auth_role() = 'system_admin' or _auth_company_id() = _rls_m.company_id`,
    ],
    [
      "D wrapper in a scalar subquery",
      `(select _auth_role()) = 'system_admin'
        or (select _auth_company_id()) = _rls_m.company_id`,
    ],
  ];

  const out: string[] = [`  ${ROWS} rows, one caller, real policy shape`, ""];
  for (const [label, predicate] of variants) {
    const sql = asCaller(
      ids.member,
      `${setup}
create policy p on _rls_m for select to authenticated using (${predicate});`,
      "explain (analyze, costs off) select count(*) from _rls_m;"
    );
    const rows = await run<Record<string, string>>(sql);
    const text = rows.map((r) => Object.values(r)[0]).filter(Boolean).join("\n");
    const f = planFacts(text);
    out.push(
      `  ${label.padEnd(32)} InitPlan=${f.initPlan ? "yes" : "no "}  ` +
        `auth_profile loops=${String(f.loops).padEnd(11)} ${f.ms} ms`
    );
    if (f.filter) out.push(`      ${f.filter.slice(0, 120)}`);
  }
  out.push("");
  return out;
}

// ---- Reading a plan --------------------------------------------
//
// One parser, used by both the InitPlan measurement and the batch
// EXPLAIN pair, so the two cannot disagree about what they saw.
export type PlanFacts = {
  initPlan: boolean;
  // "not in plan" when the helper is inside a wrapper function, which
  // is the hoisted shape. A number means it was evaluated that many
  // times.
  loops: string;
  ms: string;
  filter: string | null;
  subPlans: number;
};

export function planFacts(text: string): PlanFacts {
  return {
    initPlan: /InitPlan/.test(text),
    loops: text.match(/auth_profile[^\n]*loops=(\d+)/)?.[1] ?? "not in plan",
    ms: text.match(/Execution Time: ([\d.]+) ms/)?.[1] ?? "?",
    filter: text.split("\n").find((l) => /Filter:/.test(l))?.trim() ?? null,
    subPlans: (text.match(/SubPlan \d+/g) ?? []).length,
  };
}

// The stop condition from docs/f8-rls-hoist.md, as a function rather
// than a habit: the after-plan has to show an InitPlan, and the helper
// must not be evaluated per row. "not in plan" is the hoisted wrapper
// form (auth_profile is inside auth_role/auth_company_id, so it does
// not appear); "1" is the inline scalar form. Anything else means the
// batch does not promote.
export function afterPlanIsHoisted(after: PlanFacts): boolean {
  return after.initPlan && (after.loops === "not in plan" || after.loops === "1");
}

// ---- Batches ---------------------------------------------------
//
// One entry per F8 batch, added as each batch's PR is written. The
// table list is the batch's whole surface: acceptance runs against
// every table in it and the EXPLAIN pair is measured on each one.
// The grouping and its order are in docs/f8-rls-hoist.md.
export type Batch = {
  n: string;
  tables: readonly string[];
  // The migration the "after" side is measured with. It is applied
  // inside the same transaction as the assertion and rolled back with
  // it, so a before/after pair costs the clone nothing and needs no
  // deploy to produce.
  migration: string;
  // Tables that carry no company_id of their own and reach company
  // scope through a parent row.
  //
  // `rows` is a SELECT yielding (key, company_id) for every row of the
  // table; `key` is the expression that produces the same key from the
  // table itself. A key rather than an id because two tables in this
  // schema have no id column — company_features and csf_kpi_links,
  // which is keyed (csf_id, kpi_id) — and a helper that assumes one
  // breaks on whichever batch meets them.
  //
  // `rows` is evaluated as postgres, BEFORE the role switch. Doing it
  // inline as the caller would measure the wrong thing: the traversal
  // reads the PARENT table, whose own policy would filter it, so
  // "sees 0 of company B" could be produced by the parent's policy
  // rather than by the one under test.
  indirectScope?: Readonly<Record<string, { key: string; rows: string }>>;
  // How to create one row with a NULL company_id, per table.
  //
  // Hazard 1's case is a caller with no company against a row with no
  // company. On the clone there may be no such row — every meeting
  // routed, every source company-scoped — and a check reporting "0
  // NULL-company rows visible" against a table holding none is the
  // empty-set mistake in its purest form. So the batch provides the
  // row, created as postgres inside the rolled-back transaction.
  //
  // OPTIONAL: where real NULL-company rows already exist, no seed is
  // needed and none may be possible. profiles.id is foreign-keyed to
  // auth.users, so a profile cannot be invented — and every
  // system_admin and aims_guide already has a NULL company. The proof
  // that the case ran is the system_admin control seeing rows, not
  // the presence of a seed.
  nullCompanyRows?: Readonly<Record<string, string>>;
  // Rows a company-less caller is legitimately allowed to see, which
  // the nullable case must exclude before it counts.
  //
  // profiles is the only table this applies to and it is not a
  // loophole: everyone may read their own profile, so a company-less
  // guide sees exactly one NULL-company row - theirs - through the
  // SELF predicate. Hazard 1 is about a caller with no company
  // matching a row with no company through the TENANT predicate, so
  // the caller's own row is excluded and everything else must still
  // be denied.
  nullCompanyExclude?: Readonly<Record<string, string>>;
  // One row for a table that is empty on the clone, so the
  // deleted-user control has something to see. Self-contained SQL: it
  // runs as postgres before the role switch and gets no $name
  // substitution, so it selects whatever parents it needs inline.
  seedRows?: Readonly<Record<string, string>>;
  // One row in a company that has none, so the isolation case has
  // another tenant to be denied.
  //
  // Some tables are sparse: marketing_strategy holds a single row on
  // the clone, so "no company other than the caller's has any row"
  // is true and the check correctly refuses to call that a tenant
  // boundary. The SQL must be deterministic — it is evaluated once to
  // choose the other company and again inside the measurement — so it
  // picks by `order by co.id limit 1` rather than arbitrarily.
  isolationSeed?: Readonly<Record<string, string>>;
  // Whether the after-plan must show the helper hoisted.
  //
  // True for an F8 batch: that is its entire claim. False for a
  // migration that adds or widens a policy without rewriting one,
  // where the plans are still worth reporting — a grant should not
  // change the shape of anything — but "not hoisted" is the honest
  // answer rather than a stop condition.
  judgesHoist?: boolean;
  // Write probes for the policies this batch rewrites.
  //
  // Read plans and isolation counts say nothing about who may WRITE.
  // Batch 2 rewrote eight write policies and measured none of them:
  // the browser pass that was supposed to cover it ran as an admin,
  // whose DELETE goes through a policy with no status clause, so the
  // owner rule it was meant to exercise was never touched. E5.
  writeProbes?: WriteProbes;
};

// One row of named ids, fetched as postgres before any probe runs.
// Every probe names the columns it needs and is reported NOT PROVEN
// if any of them came back null — a probe against a missing row
// returns 0 and reads exactly like a denial.
export type WriteProbes = {
  fixtures: string;
  probes: readonly WriteProbe[];
};

export type WriteProbe = {
  name: string;
  // Fixture column holding the profile id this runs as.
  caller: string;
  // SQL returning one column `n`. $name is replaced from the fixture
  // row; the statement is expected to be a data-modifying CTE so the
  // count is rows actually affected.
  sql: string;
  // What the after run must return. "42501" for a WITH CHECK
  // violation, which raises rather than matching zero.
  expect: string;
  // What the BEFORE run must return, when the migration is meant to
  // change this answer.
  //
  // Absent, before and after must agree: that is the whole claim of a
  // behaviour-preserving batch, and a disagreement is reported as
  // SEMANTICS MOVED. Present, the probe asserts the move itself —
  // this answer was that, and is now this. A migration that widens a
  // grant has to be able to say so, and to be held to the exact
  // before it measured rather than to "something changed".
  expectBefore?: string;
  // SQL run as postgres, before the role switch, in the same
  // transaction as the probe and rolled back with it. For probes whose
  // subject should not depend on what the clone happens to contain:
  // create the row, then act on it as the caller. $name substitution
  // applies here too.
  setup?: string;
  // Required when expect is "0" AND some caller is supposed to
  // succeed. Without it a zero could be a missing row, a wrong
  // column, or a fixture that never existed — all of which look like
  // enforcement. The empty-set rule, on the write side.
  //
  // Omit it only where no caller can succeed. Establish that by
  // probing every role, not by finding two that are refused: the
  // `is_default = false` guard on function_roles looked like such a
  // rule until an aims_guide was tried, and guides turn out to edit
  // default roles that a system_admin cannot. Two zeros are not a
  // proof that a third caller would also get zero. Where the
  // exception genuinely holds, the row's existence is the thing that
  // needed proving, and a probe whose fixture came back null already
  // reports NOT PROVEN before it runs.
  provenBy?: string;
};

export const BATCHES: readonly Batch[] = [
  {
    n: "1",
    tables: ["companies", "company_features", "quarters"],
    migration: "0175_f8_batch1_hoist.sql",
  },
  {
    n: "2",
    tables: ["commitments", "commitment_occurrences"],
    migration: "0177_f8_batch2_hoist.sql",
    indirectScope: {
      commitment_occurrences: {
        key: "id",
        rows:
          "select o.id as key, c.company_id from public.commitment_occurrences o " +
          "join public.commitments c on c.id = o.commitment_id",
      },
    },
    writeProbes: {
      // One member who owns both an open and a resolved commitment,
      // and the rows around them. Chosen in SQL rather than by id so
      // the case survives a clone refresh.
      fixtures: `
        select
          m.id as member,
          m.company_id as member_company,
          (select id from public.profiles where role = 'system_admin'
             and status = 'active' limit 1) as sysadmin,
          (select id from public.profiles where role = 'company_admin'
             and status = 'active' and company_id = m.company_id limit 1) as admin,
          (select p.id from public.profiles p
             join public.guide_assignments ga on ga.guide_id = p.id
            where p.role = 'aims_guide' and p.status = 'active'
              and ga.company_id = m.company_id limit 1) as guide,
          (select id from public.commitments where owner_id = m.id
             and status = 'open' limit 1) as own_open,
          (select id from public.commitments where owner_id = m.id
             and status <> 'open' limit 1) as own_resolved,
          (select id from public.commitments where company_id = m.company_id
             and owner_id is not null and owner_id <> m.id limit 1) as others,
          (select c.id from public.commitments c
            where c.company_id <> m.company_id limit 1) as other_company_row,
          (select o.id from public.commitment_occurrences o
             join public.commitments c on c.id = o.commitment_id
            where c.owner_id = m.id limit 1) as own_occurrence,
          (select o.id from public.commitment_occurrences o
             join public.commitments c on c.id = o.commitment_id
            where c.company_id = m.company_id limit 1) as company_occurrence,
          (select o.id from public.commitment_occurrences o
             join public.commitments c on c.id = o.commitment_id
            where c.company_id <> m.company_id limit 1) as other_company_occurrence
        from (
          select p.id, p.company_id from public.profiles p
           where p.role = 'team_member' and p.status = 'active'
             and p.company_id is not null
             and exists (select 1 from public.commitments c
                          where c.owner_id = p.id and c.status = 'open')
             and exists (select 1 from public.commitments c
                          where c.owner_id = p.id and c.status <> 'open')
           -- Prefer one who also owns an occurrence. Ordering rather
           -- than requiring: on a clone with none, the owner probe
           -- should report NOT PROVEN rather than the whole batch
           -- finding no member at all.
           order by (exists (select 1 from public.commitment_occurrences o
                              join public.commitments c2 on c2.id = o.commitment_id
                             where c2.owner_id = p.id)) desc
           limit 1
        ) m;`,
      probes: [
        // --- commitments, as the owner ---
        {
          name: "member deletes own OPEN commitment",
          caller: "member",
          sql: "with d as (delete from public.commitments where id = '$own_open' returning id) select count(*)::int as n from d;",
          expect: "1",
        },
        {
          // Failure mode 7, at the database rather than in the UI.
          // The admin delete policy carries no status clause, so an
          // admin session cannot show this one.
          name: "member deletes own RESOLVED commitment",
          caller: "member",
          sql: "with d as (delete from public.commitments where id = '$own_resolved' returning id) select count(*)::int as n from d;",
          expect: "0",
          provenBy: "sysadmin",
        },
        {
          name: "member deletes someone else's commitment",
          caller: "member",
          sql: "with d as (delete from public.commitments where id = '$others' returning id) select count(*)::int as n from d;",
          expect: "0",
          provenBy: "sysadmin",
        },
        {
          name: "member updates own commitment",
          caller: "member",
          sql: "with u as (update public.commitments set description = description where id = '$own_open' returning id) select count(*)::int as n from u;",
          expect: "1",
        },
        {
          name: "member updates someone else's commitment",
          caller: "member",
          sql: "with u as (update public.commitments set description = description where id = '$others' returning id) select count(*)::int as n from u;",
          expect: "0",
          provenBy: "sysadmin",
        },
        // --- commitments, admin and guide ---
        {
          name: "company_admin updates a commitment in its company",
          caller: "admin",
          sql: "with u as (update public.commitments set description = description where id = '$others' returning id) select count(*)::int as n from u;",
          expect: "1",
        },
        {
          name: "company_admin updates another company's commitment",
          caller: "admin",
          sql: "with u as (update public.commitments set description = description where id = '$other_company_row' returning id) select count(*)::int as n from u;",
          expect: "0",
          provenBy: "sysadmin",
        },
        {
          name: "aims_guide updates a commitment in an assigned company",
          caller: "guide",
          sql: "with u as (update public.commitments set description = description where id = '$others' returning id) select count(*)::int as n from u;",
          expect: "1",
        },
        // --- commitment_occurrences, the table nothing wrote to ---
        {
          name: "member updates an occurrence of own commitment",
          caller: "member",
          sql: "with u as (update public.commitment_occurrences set status = status where id = '$own_occurrence' returning id) select count(*)::int as n from u;",
          expect: "1",
        },
        {
          name: "member updates another company's occurrence",
          caller: "member",
          sql: "with u as (update public.commitment_occurrences set status = status where id = '$other_company_occurrence' returning id) select count(*)::int as n from u;",
          expect: "0",
          provenBy: "sysadmin",
        },
        {
          name: "company_admin updates an occurrence in its company",
          caller: "admin",
          sql: "with u as (update public.commitment_occurrences set status = status where id = '$company_occurrence' returning id) select count(*)::int as n from u;",
          expect: "1",
        },
        {
          name: "aims_guide updates an occurrence in an assigned company",
          caller: "guide",
          sql: "with u as (update public.commitment_occurrences set status = status where id = '$company_occurrence' returning id) select count(*)::int as n from u;",
          expect: "1",
        },
      ],
    },
  },
  {
    n: "3",
    tables: ["strategic_focus_areas", "annual_goals", "priorities"],
    migration: "0178_f8_batch3_hoist.sql",
    writeProbes: {
      // A member who sponsors an SFA and owns a goal and a priority,
      // plus the rows around them. The owner column is sponsor_id on
      // SFAs and owner_id on the other two, which is why the probes
      // name rows rather than columns.
      // Anchored on a COMPANY, not on a person.
      //
      // The first version picked whichever profile owned the most
      // rows and allowed company_admin in the pool. It picked an
      // admin, and every WITH CHECK probe then passed the
      // reassignment it was written to forbid — correctly, because a
      // company_admin goes through _update_admin, which permits any
      // update in its own company. The owner rule only binds someone
      // whose ONLY route is _update_owner. So: a plain team_member,
      // in a company that also has an admin and a guide to run the
      // other probes as.
      fixtures: `
        with c as (
          select co.id
            from public.companies co
           order by (
             (exists (select 1 from public.profiles p
                       where p.role = 'team_member' and p.status = 'active'
                         and p.company_id = co.id
                         and (exists (select 1 from public.strategic_focus_areas s where s.sponsor_id = p.id)
                           or exists (select 1 from public.annual_goals g where g.owner_id = p.id)
                           or exists (select 1 from public.priorities pr where pr.owner_id = p.id))))::int
             + (exists (select 1 from public.profiles a
                         where a.role = 'company_admin' and a.status = 'active'
                           and a.company_id = co.id))::int
             + (exists (select 1 from public.profiles g2
                         join public.guide_assignments ga on ga.guide_id = g2.id
                        where g2.role = 'aims_guide' and g2.status = 'active'
                          and ga.company_id = co.id))::int
             + ((select count(*) from public.strategic_focus_areas s2
                  where s2.company_id = co.id) >= 2)::int
             + ((select count(*) from public.priorities p2
                  where p2.company_id = co.id) >= 1)::int
           ) desc
           limit 1
        ), m as (
          select p.id
            from public.profiles p, c
           where p.role = 'team_member' and p.status = 'active'
             and p.company_id = c.id
           order by (
             (exists (select 1 from public.strategic_focus_areas s where s.sponsor_id = p.id))::int
             + (exists (select 1 from public.annual_goals g where g.owner_id = p.id))::int
             + (exists (select 1 from public.priorities pr where pr.owner_id = p.id))::int
           ) desc
           limit 1
        )
        select
          (select id from m) as member,
          (select id from c) as member_company,
          (select id from public.profiles where role = 'system_admin'
             and status = 'active' limit 1) as sysadmin,
          (select id from public.profiles where role = 'company_admin'
             and status = 'active' and company_id = (select id from c) limit 1) as admin,
          (select p.id from public.profiles p
             join public.guide_assignments ga on ga.guide_id = p.id
            where p.role = 'aims_guide' and p.status = 'active'
              and ga.company_id = (select id from c) limit 1) as guide,
          (select id from public.profiles where company_id = (select id from c)
             and id <> (select id from m) limit 1) as colleague,
          (select id from public.strategic_focus_areas
            where sponsor_id = (select id from m) limit 1) as own_sfa,
          (select id from public.strategic_focus_areas
            where company_id = (select id from c)
              and (sponsor_id is null or sponsor_id <> (select id from m))
            limit 1) as other_sfa,
          (select id from public.strategic_focus_areas
            where company_id = (select id from c) limit 1) as company_sfa,
          (select id from public.strategic_focus_areas
            where company_id <> (select id from c) limit 1) as foreign_sfa,
          (select id from public.annual_goals
            where owner_id = (select id from m) limit 1) as own_goal,
          (select id from public.annual_goals
            where company_id <> (select id from c) limit 1) as foreign_goal,
          (select id from public.priorities
            where owner_id = (select id from m) limit 1) as own_priority,
          (select id from public.priorities
            where company_id = (select id from c) limit 1) as company_priority,
          (select id from public.priorities
            where company_id <> (select id from c) limit 1) as foreign_priority;`,
      probes: [
        // ---- the USING / WITH CHECK pair, stated as two probes ----
        //
        // USING says which rows the owner may touch. WITH CHECK says
        // what the row may become. They differ on purpose, and a
        // symmetric rewrite would drop the difference while every
        // read plan stayed identical.
        // These two create their subject rather than hunting for one.
        // No team member in the chosen company happened to sponsor an
        // SFA, and a probe that reports NOT PROVEN because of what the
        // clone contains is a probe that stops testing the rule the
        // day the data shifts. The row is created as postgres inside
        // the same transaction and rolled back with it.
        {
          name: "sponsor edits own SFA (USING)",
          caller: "member",
          setup:
            "insert into public.strategic_focus_areas (id, company_id, title, sponsor_id) " +
            "values ('11111111-1111-4111-8111-111111111111', '$member_company', 'probe sfa', '$member');",
          sql: "with u as (update public.strategic_focus_areas set title = 'probe edit' where id = '11111111-1111-4111-8111-111111111111' returning id) select count(*)::int as n from u;",
          expect: "1",
        },
        {
          name: "sponsor hands own SFA to a colleague (WITH CHECK)",
          caller: "member",
          setup:
            "insert into public.strategic_focus_areas (id, company_id, title, sponsor_id) " +
            "values ('11111111-1111-4111-8111-111111111111', '$member_company', 'probe sfa', '$member');",
          sql: "with u as (update public.strategic_focus_areas set sponsor_id = '$colleague' where id = '11111111-1111-4111-8111-111111111111' returning id) select count(*)::int as n from u;",
          expect: "42501",
        },
        {
          name: "sponsor edits an SFA they do not sponsor",
          caller: "member",
          sql: "with u as (update public.strategic_focus_areas set title = title where id = '$other_sfa' returning id) select count(*)::int as n from u;",
          expect: "0",
          provenBy: "sysadmin",
        },
        {
          name: "sponsor edits another company's SFA",
          caller: "member",
          sql: "with u as (update public.strategic_focus_areas set title = title where id = '$foreign_sfa' returning id) select count(*)::int as n from u;",
          expect: "0",
          provenBy: "sysadmin",
        },
        {
          name: "owner edits own goal (USING)",
          caller: "member",
          sql: "with u as (update public.annual_goals set title = title where id = '$own_goal' returning id) select count(*)::int as n from u;",
          expect: "1",
        },
        {
          name: "owner hands own goal to a colleague (WITH CHECK)",
          caller: "member",
          sql: "with u as (update public.annual_goals set owner_id = '$colleague' where id = '$own_goal' returning id) select count(*)::int as n from u;",
          expect: "42501",
        },
        {
          name: "owner edits another company's goal",
          caller: "member",
          sql: "with u as (update public.annual_goals set title = title where id = '$foreign_goal' returning id) select count(*)::int as n from u;",
          expect: "0",
          provenBy: "sysadmin",
        },
        {
          name: "owner edits own priority (USING)",
          caller: "member",
          sql: "with u as (update public.priorities set title = title where id = '$own_priority' returning id) select count(*)::int as n from u;",
          expect: "1",
        },
        {
          name: "owner hands own priority to a colleague (WITH CHECK)",
          caller: "member",
          sql: "with u as (update public.priorities set owner_id = '$colleague' where id = '$own_priority' returning id) select count(*)::int as n from u;",
          expect: "42501",
        },
        {
          name: "owner edits another company's priority",
          caller: "member",
          sql: "with u as (update public.priorities set title = title where id = '$foreign_priority' returning id) select count(*)::int as n from u;",
          expect: "0",
          provenBy: "sysadmin",
        },
        {
          name: "company_admin edits any priority in its company",
          caller: "admin",
          sql: "with u as (update public.priorities set title = title where id = '$company_priority' returning id) select count(*)::int as n from u;",
          expect: "1",
        },
        {
          name: "company_admin edits another company's priority",
          caller: "admin",
          sql: "with u as (update public.priorities set title = title where id = '$foreign_priority' returning id) select count(*)::int as n from u;",
          expect: "0",
          provenBy: "sysadmin",
        },
        {
          name: "company_admin deletes an SFA in its company",
          caller: "admin",
          sql: "with d as (delete from public.strategic_focus_areas where id = '$company_sfa' returning id) select count(*)::int as n from d;",
          expect: "1",
        },
        {
          name: "aims_guide edits a priority in an assigned company",
          caller: "guide",
          sql: "with u as (update public.priorities set title = title where id = '$company_priority' returning id) select count(*)::int as n from u;",
          expect: "1",
        },
        {
          name: "aims_guide edits another company's priority",
          caller: "guide",
          sql: "with u as (update public.priorities set title = title where id = '$foreign_priority' returning id) select count(*)::int as n from u;",
          expect: "0",
          provenBy: "sysadmin",
        },
      ],
    },
  },
  {
    n: "4",
    tables: [
      "functions",
      "success_measures",
      "success_measure_entries",
      "csf_kpi_links",
    ],
    migration: "0179_f8_batch4_hoist.sql",
    indirectScope: {
      success_measures: {
        key: "id",
        rows:
          "select m.id as key, f.company_id from public.success_measures m " +
          "join public.functions f on f.id = m.function_id",
      },
      success_measure_entries: {
        key: "id",
        rows:
          "select e.id as key, f.company_id from public.success_measure_entries e " +
          "join public.success_measures m on m.id = e.measure_id " +
          "join public.functions f on f.id = m.function_id",
      },
      // No id column: keyed (csf_id, kpi_id).
      csf_kpi_links: {
        key: "(csf_id::text || ':' || kpi_id::text)",
        rows:
          "select (l.csf_id::text || ':' || l.kpi_id::text) as key, f.company_id " +
          "from public.csf_kpi_links l " +
          "join public.success_measures m on m.id = l.csf_id " +
          "join public.functions f on f.id = m.function_id",
      },
    },
    writeProbes: {
      fixtures: `
        with c as (
          select co.id
            from public.companies co
           order by (
             (exists (select 1 from public.profiles a
                       where a.role = 'company_admin' and a.status = 'active'
                         and a.company_id = co.id))::int
             + (exists (select 1 from public.profiles g2
                         join public.guide_assignments ga on ga.guide_id = g2.id
                        where g2.role = 'aims_guide' and g2.status = 'active'
                          and ga.company_id = co.id))::int
             + (exists (select 1 from public.profiles p
                         where p.role = 'team_member' and p.status = 'active'
                           and p.company_id = co.id))::int
             + ((select count(*) from public.functions f2 where f2.company_id = co.id) >= 1)::int
           ) desc
           limit 1
        )
        select
          (select id from c) as company,
          (select id from public.profiles where role = 'team_member'
             and status = 'active' and company_id = (select id from c) limit 1) as member,
          (select id from public.profiles where role = 'system_admin'
             and status = 'active' limit 1) as sysadmin,
          (select id from public.profiles where role = 'company_admin'
             and status = 'active' and company_id = (select id from c) limit 1) as admin,
          (select p.id from public.profiles p
             join public.guide_assignments ga on ga.guide_id = p.id
            where p.role = 'aims_guide' and p.status = 'active'
              and ga.company_id = (select id from c) limit 1) as guide,
          (select id from public.functions where company_id = (select id from c) limit 1) as company_function,
          (select id from public.functions where company_id <> (select id from c) limit 1) as foreign_function,
          (select m.id from public.success_measures m
             join public.functions f on f.id = m.function_id
            where f.company_id = (select id from c) limit 1) as company_measure,
          (select m.id from public.success_measures m
             join public.functions f on f.id = m.function_id
            where f.company_id <> (select id from c) limit 1) as foreign_measure;`,
      probes: [
        // ---- functions, the one table with its own company_id ----
        {
          name: "company_admin edits a function in its company",
          caller: "admin",
          sql: "with u as (update public.functions set title = title where id = '$company_function' returning id) select count(*)::int as n from u;",
          expect: "1",
        },
        {
          name: "company_admin edits another company's function",
          caller: "admin",
          sql: "with u as (update public.functions set title = title where id = '$foreign_function' returning id) select count(*)::int as n from u;",
          expect: "0",
          provenBy: "sysadmin",
        },
        {
          name: "team member edits a function in their own company",
          caller: "member",
          sql: "with u as (update public.functions set title = title where id = '$company_function' returning id) select count(*)::int as n from u;",
          expect: "0",
          provenBy: "sysadmin",
        },
        {
          name: "aims_guide edits a function in an assigned company",
          caller: "guide",
          sql: "with u as (update public.functions set title = title where id = '$company_function' returning id) select count(*)::int as n from u;",
          expect: "1",
        },
        // ---- success_measures, scoped through functions ----
        {
          name: "company_admin edits a measure in its company",
          caller: "admin",
          sql: "with u as (update public.success_measures set description = description where id = '$company_measure' returning id) select count(*)::int as n from u;",
          expect: "1",
        },
        {
          name: "company_admin edits another company's measure",
          caller: "admin",
          sql: "with u as (update public.success_measures set description = description where id = '$foreign_measure' returning id) select count(*)::int as n from u;",
          expect: "0",
          provenBy: "sysadmin",
        },
        {
          name: "team member edits a measure in their own company",
          caller: "member",
          sql: "with u as (update public.success_measures set description = description where id = '$company_measure' returning id) select count(*)::int as n from u;",
          expect: "0",
          provenBy: "sysadmin",
        },
        // ---- the lead and track branch, this batch's owner rule ----
        //
        // Self-provisioned per the batch 3 decision: the probe builds
        // a function it leads and a measure under it, then writes an
        // entry as an ordinary team member with no admin rights
        // anywhere. Hunting a live lead would make the rule's coverage
        // depend on who happens to lead something this week.
        {
          name: "function LEAD records an entry on its measure",
          caller: "member",
          setup:
            "insert into public.functions (id, company_id, title, lead_id) values " +
            "('22222222-2222-4222-8222-222222222222', '$company', 'probe fn', '$member'); " +
            "insert into public.success_measures (id, function_id, description, kind) values " +
            "('33333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222', 'probe measure', 'kpi');",
          sql: "with i as (insert into public.success_measure_entries (measure_id, week_ending, value_number) values ('33333333-3333-4333-8333-333333333333', current_date, 1) returning id) select count(*)::int as n from i;",
          expect: "1",
        },
        {
          name: "function TRACK owner records an entry on its measure",
          caller: "member",
          setup:
            "insert into public.functions (id, company_id, title, track_id) values " +
            "('22222222-2222-4222-8222-222222222222', '$company', 'probe fn', '$member'); " +
            "insert into public.success_measures (id, function_id, description, kind) values " +
            "('33333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222', 'probe measure', 'kpi');",
          sql: "with i as (insert into public.success_measure_entries (measure_id, week_ending, value_number) values ('33333333-3333-4333-8333-333333333333', current_date, 1) returning id) select count(*)::int as n from i;",
          expect: "1",
        },
        {
          // Same member, same company, same shape of function — the
          // only difference is that they neither lead nor track it.
          name: "team member records an entry on a function they neither lead nor track",
          caller: "member",
          setup:
            "insert into public.functions (id, company_id, title) values " +
            "('22222222-2222-4222-8222-222222222222', '$company', 'probe fn'); " +
            "insert into public.success_measures (id, function_id, description, kind) values " +
            "('33333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222', 'probe measure', 'kpi');",
          sql: "with i as (insert into public.success_measure_entries (measure_id, week_ending, value_number) values ('33333333-3333-4333-8333-333333333333', current_date, 1) returning id) select count(*)::int as n from i;",
          expect: "42501",
        },
        {
          name: "company_admin records an entry without leading anything",
          caller: "admin",
          setup:
            "insert into public.functions (id, company_id, title) values " +
            "('22222222-2222-4222-8222-222222222222', '$company', 'probe fn'); " +
            "insert into public.success_measures (id, function_id, description, kind) values " +
            "('33333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222', 'probe measure', 'kpi');",
          sql: "with i as (insert into public.success_measure_entries (measure_id, week_ending, value_number) values ('33333333-3333-4333-8333-333333333333', current_date, 1) returning id) select count(*)::int as n from i;",
          expect: "1",
        },
      ],
    },
  },
  {
    n: "5",
    tables: [
      "meetings",
      "meeting_analyses",
      "transcript_sources",
      "transcript_aliases",
      "transcript_source_audit_log",
    ],
    migration: "0180_f8_batch5_hoist.sql",
    indirectScope: {
      meeting_analyses: {
        key: "id",
        rows:
          "select a.id as key, m.company_id from public.meeting_analyses a " +
          "join public.meetings m on m.id = a.meeting_id",
      },
    },
    nullCompanyRows: {
      meetings:
        "insert into public.meetings (id, company_id, provider_file_id, file_name, content_hash, transcript_text, status) " +
        "values ('44444444-4444-4444-8444-444444444444', null, '_probe_file', 'probe.txt', '_probe_hash', 'probe transcript', 'pending');",
      transcript_sources:
        "insert into public.transcript_sources (id, company_id, scope, provider, folder_id, folder_name) " +
        "values ('55555555-5555-4555-8555-555555555555', null, 'shared', 'google_drive', '_probe_shared', 'probe shared');",
      transcript_source_audit_log:
        "insert into public.transcript_sources (id, company_id, scope, provider, folder_id, folder_name) " +
        "values ('55555555-5555-4555-8555-555555555555', null, 'shared', 'google_drive', '_probe_shared', 'probe shared'); " +
        "insert into public.transcript_source_audit_log (source_id, company_id, event_type) " +
        "values ('55555555-5555-4555-8555-555555555555', null, 'created');",
    },
    writeProbes: {
      fixtures: `
        select
          (select id from public.profiles where role = 'system_admin'
             and status = 'active' limit 1) as sysadmin,
          (select id from public.profiles where role = 'company_admin'
             and status = 'active' limit 1) as admin,
          (select company_id from public.profiles where role = 'company_admin'
             and status = 'active' limit 1) as admin_company,
          (select id from public.profiles where role = 'team_member'
             and status = 'active' and company_id is not null limit 1) as member,
          (select id from public.transcript_sources limit 1) as a_source,
          (select id from public.meetings where company_id is not null limit 1) as a_meeting;`,
      probes: [
        // transcript_sources writes are system_admin only. This is E5's
        // second specimen measured as policy rather than described as
        // prose: the app grants these actions to company_admins through
        // a service-role client, and the database refuses every one of
        // them. The PR after this one changes that. These probes record
        // what is true beforehand, so the change has a before.
        {
          name: "company_admin pauses a transcript source",
          caller: "admin",
          sql: "with u as (update public.transcript_sources set status = status where id = '$a_source' returning id) select count(*)::int as n from u;",
          expect: "0",
          provenBy: "sysadmin",
        },
        {
          name: "company_admin removes a transcript source",
          caller: "admin",
          sql: "with d as (delete from public.transcript_sources where id = '$a_source' returning id) select count(*)::int as n from d;",
          expect: "0",
          provenBy: "sysadmin",
        },
        {
          name: "company_admin connects a folder",
          caller: "admin",
          sql: "with i as (insert into public.transcript_sources (company_id, scope, provider, folder_id, folder_name) values ('$admin_company', 'company', 'google_drive', '_probe_connect', 'probe') returning id) select count(*)::int as n from i;",
          expect: "42501",
        },
        {
          name: "system_admin connects a folder",
          caller: "sysadmin",
          sql: "with i as (insert into public.transcript_sources (company_id, scope, provider, folder_id, folder_name) values ('$admin_company', 'company', 'google_drive', '_probe_connect', 'probe') returning id) select count(*)::int as n from i;",
          expect: "1",
        },
        {
          name: "system_admin routes a meeting",
          caller: "sysadmin",
          sql: "with u as (update public.meetings set company_id = company_id where id = '$a_meeting' returning id) select count(*)::int as n from u;",
          expect: "1",
        },
        {
          name: "company_admin routes a meeting",
          caller: "admin",
          sql: "with u as (update public.meetings set company_id = company_id where id = '$a_meeting' returning id) select count(*)::int as n from u;",
          expect: "0",
          provenBy: "sysadmin",
        },
        {
          name: "team member routes a meeting",
          caller: "member",
          sql: "with u as (update public.meetings set company_id = company_id where id = '$a_meeting' returning id) select count(*)::int as n from u;",
          expect: "0",
          provenBy: "sysadmin",
        },
      ],
    },
  },
  // Not an F8 batch: migration 0181 changes who is admitted, which no
  // batch does. It reuses the same machinery because the question is
  // identical — what can each role actually write — and because F8
  // batch 5 measured the before.
  {
    n: "grants",
    tables: ["transcript_sources", "transcript_aliases", "meetings"],
    migration: "0181_transcript_admin_grants.sql",
    // 0181 adds policies, it does not rewrite any. The plans are
    // reported because a grant should not change the shape of
    // anything, and not judged because "hoisted" is not its claim.
    judgesHoist: false,
    nullCompanyRows: {
      meetings:
        "insert into public.meetings (id, company_id, provider_file_id, file_name, content_hash, transcript_text, status) " +
        "values ('44444444-4444-4444-8444-444444444444', null, '_probe_file', 'probe.txt', '_probe_hash', 'probe transcript', 'pending');",
      transcript_sources:
        "insert into public.transcript_sources (id, company_id, scope, provider, folder_id, folder_name) " +
        "values ('55555555-5555-4555-8555-555555555555', null, 'shared', 'google_drive', '_probe_shared', 'probe shared');",
    },
    writeProbes: {
      fixtures: `
        with c as (
          select co.id from public.companies co
           where exists (select 1 from public.profiles a
                          where a.role = 'company_admin' and a.status = 'active'
                            and a.company_id = co.id)
           order by (select count(*) from public.transcript_sources s
                      where s.company_id = co.id) desc
           limit 1
        )
        select
          (select id from c) as company,
          (select id from public.profiles where role = 'system_admin'
             and status = 'active' limit 1) as sysadmin,
          (select id from public.profiles where role = 'company_admin'
             and status = 'active' and company_id = (select id from c) limit 1) as admin,
          (select id from public.profiles where role = 'company_admin'
             and status = 'active' and company_id <> (select id from c) limit 1) as other_admin,
          (select id from public.profiles where role = 'team_member'
             and status = 'active' and company_id = (select id from c) limit 1) as member;`,
      probes: [
        // The three F8 batch 5 measured as 0, 0 and 42501.
        {
          name: "company_admin pauses a source in its company",
          expectBefore: "0",
          caller: "admin",
          setup:
            "insert into public.transcript_sources (id, company_id, scope, provider, folder_id, folder_name) " +
            "values ('66666666-6666-4666-8666-666666666666', '$company', 'company', 'google_drive', '_probe_own', 'probe own');",
          sql: "with u as (update public.transcript_sources set status = 'paused' where id = '66666666-6666-4666-8666-666666666666' returning id) select count(*)::int as n from u;",
          expect: "1",
        },
        {
          name: "company_admin removes a source in its company",
          expectBefore: "0",
          caller: "admin",
          setup:
            "insert into public.transcript_sources (id, company_id, scope, provider, folder_id, folder_name) " +
            "values ('66666666-6666-4666-8666-666666666666', '$company', 'company', 'google_drive', '_probe_own', 'probe own');",
          sql: "with d as (delete from public.transcript_sources where id = '66666666-6666-4666-8666-666666666666' returning id) select count(*)::int as n from d;",
          expect: "1",
        },
        {
          name: "company_admin connects a folder for its company",
          expectBefore: "42501",
          caller: "admin",
          sql: "with i as (insert into public.transcript_sources (company_id, scope, provider, folder_id, folder_name) values ('$company', 'company', 'google_drive', '_probe_connect', 'probe') returning id) select count(*)::int as n from i;",
          expect: "1",
        },
        // And the boundaries that must not move.
        {
          name: "company_admin touches ANOTHER company's source",
          caller: "other_admin",
          setup:
            "insert into public.transcript_sources (id, company_id, scope, provider, folder_id, folder_name) " +
            "values ('66666666-6666-4666-8666-666666666666', '$company', 'company', 'google_drive', '_probe_own', 'probe own');",
          sql: "with u as (update public.transcript_sources set status = 'paused' where id = '66666666-6666-4666-8666-666666666666' returning id) select count(*)::int as n from u;",
          expect: "0",
          provenBy: "sysadmin",
        },
        {
          name: "company_admin connects a folder for ANOTHER company",
          caller: "other_admin",
          sql: "with i as (insert into public.transcript_sources (company_id, scope, provider, folder_id, folder_name) values ('$company', 'company', 'google_drive', '_probe_connect', 'probe') returning id) select count(*)::int as n from i;",
          expect: "42501",
        },
        {
          name: "company_admin touches a SHARED-scope source",
          caller: "admin",
          setup:
            "insert into public.transcript_sources (id, company_id, scope, provider, folder_id, folder_name) " +
            "values ('55555555-5555-4555-8555-555555555555', null, 'shared', 'google_drive', '_probe_shared', 'probe shared');",
          sql: "with u as (update public.transcript_sources set status = 'paused' where id = '55555555-5555-4555-8555-555555555555' returning id) select count(*)::int as n from u;",
          expect: "0",
          provenBy: "sysadmin",
        },
        {
          name: "team member pauses a source in their own company",
          caller: "member",
          setup:
            "insert into public.transcript_sources (id, company_id, scope, provider, folder_id, folder_name) " +
            "values ('66666666-6666-4666-8666-666666666666', '$company', 'company', 'google_drive', '_probe_own', 'probe own');",
          sql: "with u as (update public.transcript_sources set status = 'paused' where id = '66666666-6666-4666-8666-666666666666' returning id) select count(*)::int as n from u;",
          expect: "0",
          provenBy: "sysadmin",
        },
        // Aliases, same grant.
        {
          name: "company_admin registers an alias for its company",
          expectBefore: "42501",
          caller: "admin",
          sql: "with i as (insert into public.transcript_aliases (company_id, alias) values ('$company', '_probe_alias') returning id) select count(*)::int as n from i;",
          expect: "1",
        },
        {
          name: "company_admin registers an alias for ANOTHER company",
          caller: "other_admin",
          sql: "with i as (insert into public.transcript_aliases (company_id, alias) values ('$company', '_probe_alias') returning id) select count(*)::int as n from i;",
          expect: "42501",
        },
        // Meeting routing: own company yes, unrouted no.
        {
          name: "company_admin re-routes a meeting already in its company",
          expectBefore: "0",
          caller: "admin",
          setup:
            "insert into public.meetings (id, company_id, provider_file_id, file_name, content_hash, transcript_text, status) " +
            "values ('77777777-7777-4777-8777-777777777777', '$company', '_probe_m', 'm.txt', '_h', 't', 'pending');",
          sql: "with u as (update public.meetings set status = 'pending' where id = '77777777-7777-4777-8777-777777777777' returning id) select count(*)::int as n from u;",
          expect: "1",
        },
        {
          name: "company_admin claims an UNROUTED meeting",
          caller: "admin",
          setup:
            "insert into public.meetings (id, company_id, provider_file_id, file_name, content_hash, transcript_text, status) " +
            "values ('44444444-4444-4444-8444-444444444444', null, '_probe_file', 'probe.txt', '_probe_hash', 'probe transcript', 'pending');",
          sql: "with u as (update public.meetings set company_id = '$company' where id = '44444444-4444-4444-8444-444444444444' returning id) select count(*)::int as n from u;",
          expect: "0",
          provenBy: "sysadmin",
        },
      ],
    },
  },
  {
    n: "6a",
    tables: [
      "function_roles",
      "function_competencies",
      "function_decision_rights",
      "functional_areas",
      "role_description_documents",
      "role_description_versions",
    ],
    migration: "0182_f8_batch6a_hoist.sql",
    // Empty on the clone: no role description has ever been
    // published there, so without this the deleted-user control sees
    // zero and the check cannot run.
    seedRows: {
      role_description_versions:
        "insert into public.role_description_versions " +
        "(function_id, version_number, snapshot_document) " +
        "select id, 1, '{}'::jsonb from public.functions limit 1;",
    },
    indirectScope: {
      function_roles: {
        key: "id",
        rows:
          "select t.id as key, f.company_id from public.function_roles t " +
          "join public.functions f on f.id = t.function_id",
      },
      function_competencies: {
        key: "id",
        rows:
          "select t.id as key, f.company_id from public.function_competencies t " +
          "join public.functions f on f.id = t.function_id",
      },
      function_decision_rights: {
        key: "id",
        rows:
          "select t.id as key, f.company_id from public.function_decision_rights t " +
          "join public.functions f on f.id = t.function_id",
      },
      role_description_documents: {
        key: "id",
        rows:
          "select t.id as key, f.company_id from public.role_description_documents t " +
          "join public.functions f on f.id = t.function_id",
      },
      role_description_versions: {
        key: "id",
        rows:
          "select t.id as key, f.company_id from public.role_description_versions t " +
          "join public.functions f on f.id = t.function_id",
      },
    },
    writeProbes: {
      fixtures: `
        with c as (
          select co.id from public.companies co
           where exists (select 1 from public.profiles a
                          where a.role = 'company_admin' and a.status = 'active'
                            and a.company_id = co.id)
             and exists (select 1 from public.functions f where f.company_id = co.id)
           limit 1
        )
        select
          (select id from c) as company,
          (select id from public.profiles where role = 'system_admin'
             and status = 'active' limit 1) as sysadmin,
          (select id from public.profiles where role = 'company_admin'
             and status = 'active' and company_id = (select id from c) limit 1) as admin,
          (select id from public.profiles where role = 'team_member'
             and status = 'active' and company_id = (select id from c) limit 1) as member,
          (select id from public.functions where company_id = (select id from c) limit 1) as fn,
          (select id from public.functions where company_id <> (select id from c) limit 1) as foreign_fn,
          (select id from public.functional_areas where company_id = (select id from c) limit 1) as area,
          (select id from public.functional_areas where company_id <> (select id from c) limit 1) as foreign_area,
          (select r.id from public.function_roles r join public.functions f on f.id = r.function_id
            where f.company_id = (select id from c) and r.is_default limit 1) as default_role,
          (select r.id from public.function_roles r join public.functions f on f.id = r.function_id
            where f.company_id = (select id from c) and not r.is_default limit 1) as normal_role,
          (select p.id from public.profiles p
             join public.guide_assignments ga on ga.guide_id = p.id
            where p.role = 'aims_guide' and p.status = 'active' limit 1) as guide,
          (select r.id from public.function_roles r
             join public.functions f on f.id = r.function_id
             join public.guide_assignments ga on ga.company_id = f.company_id
             join public.profiles p on p.id = ga.guide_id
            where p.role = 'aims_guide' and p.status = 'active'
              and r.is_default limit 1) as guide_default_role;`,
      probes: [
        {
          name: "company_admin adds a role to a function in its company",
          caller: "admin",
          sql: "with i as (insert into public.function_roles (function_id, title) values ('$fn', 'probe role') returning id) select count(*)::int as n from i;",
          expect: "1",
        },
        {
          name: "company_admin adds a role to another company's function",
          caller: "admin",
          sql: "with i as (insert into public.function_roles (function_id, title) values ('$foreign_fn', 'probe role') returning id) select count(*)::int as n from i;",
          expect: "42501",
        },
        {
          name: "team member adds a role to a function in their own company",
          caller: "member",
          sql: "with i as (insert into public.function_roles (function_id, title) values ('$fn', 'probe role') returning id) select count(*)::int as n from i;",
          expect: "42501",
        },
        // The is_default guard: nobody edits a default role, admin or
        // not. It sits outside the tenant predicate and this batch
        // must not disturb it.
        {
          // No provenBy, but NOT because the rule admits nobody —
          // see the guide probe below, which is the control this one
          // needs and the reason the first version of this comment
          // was wrong. A system_admin is refused here too, so neither
          // admin role can serve as the control; the guide can, and
          // the fixture lookup proves the row exists.
          name: "company_admin edits a DEFAULT role on its own function",
          caller: "admin",
          sql: "with u as (update public.function_roles set title = 'edited' where id = '$default_role' returning id) select count(*)::int as n from u;",
          expect: "0",
        },
        {
          name: "company_admin edits a NON-default role on its own function",
          caller: "admin",
          setup:
            "insert into public.function_roles (id, function_id, title, is_default) " +
            "select '99999999-9999-4999-8999-999999999999', id, 'probe normal', false " +
            "from public.functions where id = '$fn';",
          sql: "with u as (update public.function_roles set title = 'edited' where id = '99999999-9999-4999-8999-999999999999' returning id) select count(*)::int as n from u;",
          expect: "1",
        },
        // RECORDED, NOT FIXED. The _guide mirrors carry no
        // is_default clause, so a guide edits and deletes default
        // roles that a system_admin cannot touch. That asymmetry is
        // live on the fleet today and 0182 preserves it exactly,
        // because this batch moves how a predicate is evaluated and
        // never who is admitted. Changing it is a semantic decision
        // and belongs in its own PR with its own measured before —
        // which this probe is.
        {
          name: "aims_guide edits a DEFAULT role in an assigned company",
          caller: "guide",
          sql: "with u as (update public.function_roles set title = 'probe edit' where id = '$guide_default_role' returning id) select count(*)::int as n from u;",
          expect: "1",
        },
        {
          name: "company_admin edits a functional area in its company",
          caller: "admin",
          sql: "with u as (update public.functional_areas set name = name where id = '$area' returning id) select count(*)::int as n from u;",
          expect: "1",
        },
        {
          name: "company_admin edits another company's functional area",
          caller: "admin",
          sql: "with u as (update public.functional_areas set name = name where id = '$foreign_area' returning id) select count(*)::int as n from u;",
          expect: "0",
          provenBy: "sysadmin",
        },
      ],
    },
  },
  {
    n: "6b",
    tables: [
      "company_foundation",
      "foundation_items",
      "marketing_strategy",
      "marketing_snippets",
      "messaging_pillars",
      "scorecard_metrics",
      "scorecard_entries",
    ],
    migration: "0183_f8_batch6b_hoist.sql",
    // Both tables hold rows for exactly one company on the clone, so
    // isolation had nothing to deny until it was given something.
    isolationSeed: {
      marketing_strategy:
        "insert into public.marketing_strategy (company_id) " +
        "select co.id from public.companies co " +
        " where not exists (select 1 from public.marketing_strategy t where t.company_id = co.id) " +
        " order by co.id limit 1;",
      messaging_pillars:
        "insert into public.messaging_pillars (company_id, name) " +
        "select co.id, 'probe pillar' from public.companies co " +
        " where not exists (select 1 from public.messaging_pillars t where t.company_id = co.id) " +
        " order by co.id limit 1;",
    },
    writeProbes: {
      // Anchored on a functional area whose accountable person is a
      // PLAIN TEAM MEMBER.
      //
      // Half the accountable people on this clone are company_admins,
      // and the first version of this fixture picked one — so the
      // probes that were supposed to isolate the accountable branch
      // were passing through the admin branch instead, and reported a
      // delete as permitted that the accountable branch does not
      // permit. Same trap as batch 3's owner probes.
      fixtures: `
        with a as (
          select fa.id as area_id, fa.company_id, fa.accountable_id
            from public.functional_areas fa
            join public.profiles p on p.id = fa.accountable_id
           where p.role = 'team_member' and p.status = 'active'
             and exists (select 1 from public.scorecard_metrics m
                          where m.functional_area_id = fa.id)
           limit 1
        ), c as (select company_id from a)
        select
          (select company_id from c) as company,
          (select accountable_id from a) as accountable,
          (select m.id from public.scorecard_metrics m
            where m.functional_area_id = (select area_id from a) limit 1) as owned_metric,
          (select id from public.profiles where role = 'system_admin'
             and status = 'active' limit 1) as sysadmin,
          (select id from public.profiles where role = 'company_admin'
             and status = 'active' and company_id = (select company_id from c) limit 1) as admin,

          (select id from public.scorecard_metrics
            where company_id <> (select company_id from c) limit 1) as foreign_metric,
          (select company_id from public.company_foundation
            where company_id = (select company_id from c) limit 1) as foundation,
          (select company_id from public.company_foundation
            where company_id <> (select company_id from c) limit 1) as foreign_foundation;`,
      probes: [
        {
          name: "company_admin edits its own company's foundation",
          caller: "admin",
          sql: "with u as (update public.company_foundation set updated_at = updated_at where company_id = '$foundation' returning company_id) select count(*)::int as n from u;",
          expect: "1",
        },
        {
          name: "company_admin edits another company's foundation",
          caller: "admin",
          sql: "with u as (update public.company_foundation set updated_at = updated_at where company_id = '$foreign_foundation' returning company_id) select count(*)::int as n from u;",
          expect: "0",
          provenBy: "sysadmin",
        },
        // The accountable branch: the person who owns a functional
        // area may record its numbers without admin rights anywhere.
        {
          name: "accountable person records an entry on their area's metric",
          caller: "accountable",
          sql: "with i as (insert into public.scorecard_entries (company_id, metric_id, week_ending, value_number) values ('$company', '$owned_metric', current_date, 1) returning id) select count(*)::int as n from i;",
          expect: "1",
        },
        {
          // Same caller, a metric on an area they do not own. The one
          // variable is accountability.
          // Self-provisioned: every functional area in these
          // companies has an accountable person, so a metric nobody
          // owns has to be made rather than found.
          name: "accountable person records an entry on a metric they do not own",
          caller: "accountable",
          setup:
            "insert into public.functional_areas (id, company_id, name) values " +
            "('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '$company', 'probe area'); " +
            "insert into public.scorecard_metrics (id, company_id, functional_area_id, name) values " +
            "('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '$company', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'probe metric');",
          sql: "with i as (insert into public.scorecard_entries (company_id, metric_id, week_ending, value_number) values ('$company', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', current_date, 1) returning id) select count(*)::int as n from i;",
          expect: "42501",
        },
        {
          name: "accountable person records an entry for another company",
          caller: "accountable",
          sql: "with i as (insert into public.scorecard_entries (company_id, metric_id, week_ending, value_number) values ('$company', '$foreign_metric', current_date, 1) returning id) select count(*)::int as n from i;",
          expect: "42501",
        },
        {
          // Recording is not removing: the delete policy carries no
          // accountable branch, so the same person is refused here.
          name: "accountable person deletes an entry on their own metric",
          caller: "accountable",
          setup:
            "insert into public.scorecard_entries (id, company_id, metric_id, week_ending, value_number) " +
            "values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '$company', '$owned_metric', current_date, 1);",
          sql: "with d as (delete from public.scorecard_entries where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' returning id) select count(*)::int as n from d;",
          expect: "0",
          provenBy: "admin",
        },
        {
          name: "company_admin edits a scorecard metric in its company",
          caller: "admin",
          sql: "with u as (update public.scorecard_metrics set updated_at = updated_at where id = '$owned_metric' returning id) select count(*)::int as n from u;",
          expect: "1",
        },
        {
          name: "company_admin edits another company's scorecard metric",
          caller: "admin",
          sql: "with u as (update public.scorecard_metrics set updated_at = updated_at where id = '$foreign_metric' returning id) select count(*)::int as n from u;",
          expect: "0",
          provenBy: "sysadmin",
        },
      ],
    },
  },
  {
    n: "6c",
    tables: [
      "strengths_assessments",
      "strengths_items",
      "strengths_responses",
      "strengths_results",
      "strengths_teams",
      "strengths_team_members",
    ],
    migration: "0184_f8_batch6c_hoist.sql",
    // strengths_assessments allows a NULL company: a personal
    // assessment taken outside any company. None exist on the clone,
    // so hazard 1's case has to be given one.
    nullCompanyRows: {
      strengths_assessments:
        "insert into public.strengths_assessments (id, user_id, company_id) " +
        "select '22222222-3333-4444-8555-666666666666', p.id, null " +
        "from public.profiles p where p.company_id is not null limit 1;",
    },
    // No strengths team has ever been created on the clone, so both
    // team tables are empty and their controls could see nothing.
    seedRows: {
      strengths_teams:
        "insert into public.strengths_teams (id, company_id, name, mission_type) " +
        "select '11111111-2222-4333-8444-555555555555', co.id, 'probe team', 'general' " +
        "from public.companies co order by co.id limit 1;",
      strengths_team_members:
        "insert into public.strengths_teams (id, company_id, name, mission_type) " +
        "select '11111111-2222-4333-8444-555555555555', co.id, 'probe team', 'general' " +
        "from public.companies co order by co.id limit 1; " +
        "insert into public.strengths_team_members (team_id, profile_id) " +
        "select '11111111-2222-4333-8444-555555555555', p.id from public.profiles p " +
        "where p.company_id = (select co.id from public.companies co order by co.id limit 1) limit 1;",
    },
    indirectScope: {
      strengths_responses: {
        key: "id",
        rows:
          "select r.id as key, a.company_id from public.strengths_responses r " +
          "join public.strengths_assessments a on a.id = r.assessment_id",
      },
      strengths_results: {
        key: "id",
        rows:
          "select r.id as key, a.company_id from public.strengths_results r " +
          "join public.strengths_assessments a on a.id = r.assessment_id",
      },
      strengths_team_members: {
        key: "id",
        rows:
          "select m.id as key, t.company_id from public.strengths_team_members m " +
          "join public.strengths_teams t on t.id = m.team_id",
      },
      // The shared item bank: every caller sees the same rows and no
      // row belongs to a company at all.
      strengths_items: {
        key: "id",
        rows: "select id as key, null::uuid as company_id from public.strengths_items",
      },
    },
    writeProbes: {
      fixtures: `
        with a as (
          select sa.id, sa.user_id, sa.company_id
            from public.strengths_assessments sa
            join public.profiles p on p.id = sa.user_id
           where sa.company_id is not null and p.role = 'team_member'
             and p.status = 'active'
           limit 1
        )
        select
          (select company_id from a) as company,
          (select id from a) as own_assessment,
          (select user_id from a) as subject,
          (select id from public.profiles where role = 'system_admin'
             and status = 'active' limit 1) as sysadmin,
          (select id from public.profiles where role = 'company_admin'
             and status = 'active' and company_id = (select company_id from a) limit 1) as admin,
          (select id from public.profiles where role = 'company_admin'
             and status = 'active' and company_id <> (select company_id from a) limit 1) as other_admin,
          (select id from public.profiles where role = 'team_member' and status = 'active'
             and company_id = (select company_id from a)
             and id <> (select user_id from a) limit 1) as colleague,
          (select sa.id from public.strengths_assessments sa
            where sa.company_id is not null
              and sa.company_id <> (select company_id from a) limit 1) as foreign_assessment;`,
      probes: [
        // The owner rule: your own assessment is yours.
        {
          name: "subject updates their own assessment",
          caller: "subject",
          sql: "with u as (update public.strengths_assessments set status = status where id = '$own_assessment' returning id) select count(*)::int as n from u;",
          expect: "1",
        },
        {
          name: "a colleague updates someone else's assessment",
          caller: "colleague",
          sql: "with u as (update public.strengths_assessments set status = status where id = '$own_assessment' returning id) select count(*)::int as n from u;",
          expect: "0",
          provenBy: "subject",
        },
        {
          // The update policy is owner-only: even the company's admin
          // is refused, which is why the control is the subject.
          name: "company_admin updates a member's assessment",
          caller: "admin",
          sql: "with u as (update public.strengths_assessments set status = status where id = '$own_assessment' returning id) select count(*)::int as n from u;",
          expect: "0",
          provenBy: "subject",
        },
        {
          // Self-provisioned: the subject's existing assessment already
          // has an answer for every item, so a fresh one is made
          // rather than hunting an unanswered slot.
          name: "subject records a response on their own assessment",
          caller: "subject",
          setup:
            "insert into public.strengths_assessments (id, user_id, company_id, version) " +
            "values ('33333333-4444-4555-8666-777777777777', '$subject', '$company', 99);",
          sql: "with i as (insert into public.strengths_responses (assessment_id, item_id, value) select '33333333-4444-4555-8666-777777777777', id, 3 from public.strengths_items limit 1 returning id) select count(*)::int as n from i;",
          expect: "1",
        },
        {
          name: "a colleague records a response on someone else's assessment",
          caller: "colleague",
          sql: "with i as (insert into public.strengths_responses (assessment_id, item_id, value) select '$own_assessment', i.id, 3 from public.strengths_items i where not exists (select 1 from public.strengths_responses r where r.assessment_id = '$own_assessment' and r.item_id = i.id) limit 1 returning id) select count(*)::int as n from i;",
          expect: "42501",
        },
        {
          name: "company_admin creates a strengths team in its company",
          caller: "admin",
          sql: "with i as (insert into public.strengths_teams (company_id, name, mission_type) values ('$company', 'probe team', 'general') returning id) select count(*)::int as n from i;",
          expect: "1",
        },
        {
          name: "company_admin creates a strengths team in ANOTHER company",
          caller: "other_admin",
          sql: "with i as (insert into public.strengths_teams (company_id, name, mission_type) values ('$company', 'probe team', 'general') returning id) select count(*)::int as n from i;",
          expect: "42501",
        },
      ],
    },
  },
  {
    n: "6d",
    tables: [
      "classroom_categories",
      "classroom_tags",
      "classroom_lessons",
      "classroom_trainings",
    ],
    migration: "0185_f8_batch6d_hoist.sql",
    // No classroom tag has ever been created on the clone.
    seedRows: {
      classroom_tags:
        "insert into public.classroom_tags (name, slug) values ('probe tag', 'probe-tag');",
    },
    // Platform content: no table here has a company_id, so every row
    // belongs to everyone entitled to see it and to nobody in
    // particular. Tenant isolation is not the mechanism; entitlement
    // is, and the write probes are where that gets tested.
    indirectScope: {
      classroom_categories: { key: "id", rows: "select id as key, null::uuid as company_id from public.classroom_categories" },
      classroom_tags: { key: "id", rows: "select id as key, null::uuid as company_id from public.classroom_tags" },
      classroom_lessons: { key: "id", rows: "select id as key, null::uuid as company_id from public.classroom_lessons" },
      classroom_trainings: { key: "id", rows: "select id as key, null::uuid as company_id from public.classroom_trainings" },
    },
    writeProbes: {
      fixtures: `
        select
          (select id from public.profiles where role = 'system_admin'
             and status = 'active' limit 1) as sysadmin,
          (select p.id from public.profiles p
             join public.company_features f on f.company_id = p.company_id
            where p.role = 'company_admin' and p.status = 'active'
              and f.feature = 'classroom' and f.enabled_at is not null limit 1) as entitled_admin,
          (select p.id from public.profiles p
             join public.company_features f on f.company_id = p.company_id
            where p.role = 'team_member' and p.status = 'active'
              and f.feature = 'classroom' and f.enabled_at is not null limit 1) as entitled_member,
          (select p.id from public.profiles p
            where p.role = 'team_member' and p.status = 'active'
              and p.company_id is not null
              and not exists (select 1 from public.company_features f
                               where f.company_id = p.company_id
                                 and f.feature = 'classroom'
                                 and f.enabled_at is not null) limit 1) as unentitled_member,
          (select id from public.classroom_lessons where published limit 1) as published_lesson;`,
      probes: [
        // Writes are platform-level: nobody but a system_admin, however
        // entitled their company is.
        {
          name: "system_admin creates a classroom category",
          caller: "sysadmin",
          sql: "with i as (insert into public.classroom_categories (name, slug) values ('probe category', 'probe-category') returning id) select count(*)::int as n from i;",
          expect: "1",
        },
        {
          name: "entitled company_admin creates a classroom category",
          caller: "entitled_admin",
          sql: "with i as (insert into public.classroom_categories (name, slug) values ('probe category', 'probe-category') returning id) select count(*)::int as n from i;",
          expect: "42501",
        },
        {
          name: "entitled company_admin edits a published lesson",
          caller: "entitled_admin",
          sql: "with u as (update public.classroom_lessons set updated_at = updated_at where id = '$published_lesson' returning id) select count(*)::int as n from u;",
          expect: "0",
          provenBy: "sysadmin",
        },
        // The entitlement gate, which is what this group's reads turn
        // on. An unpublished lesson is invisible to everyone but a
        // system_admin, so the published one is the fair comparison.
        {
          name: "entitled member can see a published lesson",
          caller: "entitled_member",
          sql: "select count(*)::int as n from public.classroom_lessons where id = '$published_lesson';",
          expect: "1",
        },
        {
          name: "UNENTITLED member cannot see the same published lesson",
          caller: "unentitled_member",
          sql: "select count(*)::int as n from public.classroom_lessons where id = '$published_lesson';",
          expect: "0",
          provenBy: "entitled_member",
        },
      ],
    },
  },
  {
    n: "6e",
    tables: [
      "issues",
      "dashboard_ai_briefs",
      "company_discipline_snapshots",
      "coaching_conversations",
      "coach_token_usage",
    ],
    migration: "0186_f8_batch6e_hoist.sql",
    // coach_token_usage carries a nullable company_id: platform-level
    // spend that belongs to no tenant. None exist on the clone.
    nullCompanyRows: {
      coach_token_usage:
        "insert into public.coach_token_usage (company_id, purpose, model) " +
        "values (null, 'other', 'claude-probe');",
    },
    indirectScope: {
      // Platform telemetry: no company_id, system_admin only.
      coach_token_usage: {
        key: "id",
        rows: "select id as key, null::uuid as company_id from public.coach_token_usage",
      },
      coaching_conversations: {
        key: "id",
        rows: "select id as key, company_id from public.coaching_conversations",
      },
    },
    writeProbes: {
      fixtures: `
        with c as (
          select co.id from public.companies co
           where exists (select 1 from public.profiles p
                          where p.company_id = co.id and p.role = 'company_admin'
                            and p.status = 'active')
             and exists (select 1 from public.profiles p
                          where p.company_id = co.id and p.role = 'team_member'
                            and p.status = 'active')
           limit 1
        )
        select
          (select id from c) as company,
          (select id from public.profiles where role = 'system_admin'
             and status = 'active' limit 1) as sysadmin,
          (select id from public.profiles where role = 'company_admin'
             and status = 'active' and company_id = (select id from c) limit 1) as admin,
          (select id from public.profiles where role = 'team_member'
             and status = 'active' and company_id = (select id from c) limit 1) as member,
          (select id from public.profiles where role = 'team_member' and status = 'active'
             and company_id is not null and company_id <> (select id from c) limit 1) as outsider,
          (select id from public.issues where company_id = (select id from c) limit 1) as own_issue,
          (select id from public.issues where company_id <> (select id from c) limit 1) as foreign_issue;`,
      probes: [
        {
          name: "team member raises an issue in their own company",
          caller: "member",
          sql: "with i as (insert into public.issues (company_id, title, created_by) values ('$company', 'probe issue', '$member') returning id) select count(*)::int as n from i;",
          expect: "1",
        },
        {
          name: "team member raises an issue in ANOTHER company",
          caller: "outsider",
          sql: "with i as (insert into public.issues (company_id, title, created_by) values ('$company', 'probe issue', '$outsider') returning id) select count(*)::int as n from i;",
          expect: "42501",
        },
        {
          // issues_update_creator: the raiser may edit their own, and
          // issues_update_admin covers the company's admin. A member
          // who raised nothing is covered by neither.
          name: "team member edits an issue they did not raise",
          caller: "member",
          setup:
            "insert into public.issues (id, company_id, title, created_by) " +
            "select 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', '$company', 'probe issue', p.id " +
            "from public.profiles p where p.company_id = '$company' and p.id <> '$member' limit 1;",
          sql: "with u as (update public.issues set title = 'edited' where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' returning id) select count(*)::int as n from u;",
          expect: "0",
          provenBy: "admin",
        },
        {
          name: "company_admin edits any issue in its company",
          caller: "admin",
          sql: "with u as (update public.issues set title = title where id = '$own_issue' returning id) select count(*)::int as n from u;",
          expect: "1",
        },
        {
          name: "company_admin edits another company's issue",
          caller: "admin",
          sql: "with u as (update public.issues set title = title where id = '$foreign_issue' returning id) select count(*)::int as n from u;",
          expect: "0",
          provenBy: "sysadmin",
        },
        // dashboard_ai_briefs admits admins only, by an explicit role
        // list rather than the usual shape.
        {
          name: "company_admin writes a brief for its own company",
          caller: "admin",
          sql: "with i as (insert into public.dashboard_ai_briefs (company_id, brief_date, content) values ('$company', current_date, 'probe brief') returning id) select count(*)::int as n from i;",
          expect: "1",
        },
        {
          name: "team member writes a brief for their own company",
          caller: "member",
          sql: "with i as (insert into public.dashboard_ai_briefs (company_id, brief_date, content) values ('$company', current_date, 'probe brief') returning id) select count(*)::int as n from i;",
          expect: "42501",
        },
        // Platform telemetry: nobody below system_admin reads it.
        {
          name: "company_admin reads coach token usage",
          caller: "admin",
          sql: "select count(*)::int as n from public.coach_token_usage;",
          expect: "0",
          provenBy: "sysadmin",
        },
      ],
    },
  },
  {
    n: "6f",
    tables: ["profiles", "guide_assignments", "company_feature_events"],
    migration: "0187_f8_batch6f_hoist.sql",
    // No seed: profiles.id is foreign-keyed to auth.users, so a
    // profile cannot be invented, and none is needed - every
    // system_admin and every aims_guide already has a NULL company.
    nullCompanyExclude: {
      // Everyone may read their own profile. See the type.
      profiles: "id <> (select auth.uid())",
    },
    indirectScope: {
      // Keyed (guide_id, company_id): no id column. The fourth table
      // this session where assuming one would have been wrong, after
      // company_features, csf_kpi_links and company_foundation.
      guide_assignments: {
        key: "(guide_id::text || ':' || company_id::text)",
        rows:
          "select (guide_id::text || ':' || company_id::text) as key, company_id " +
          "from public.guide_assignments",
      },
    },
    writeProbes: {
      fixtures: `
        with c as (
          select co.id from public.companies co
           where exists (select 1 from public.profiles p where p.company_id = co.id
                          and p.role = 'company_admin' and p.status = 'active')
             and exists (select 1 from public.profiles p where p.company_id = co.id
                          and p.role = 'team_member' and p.status = 'active')
           limit 1
        )
        select
          (select id from c) as company,
          (select id from public.profiles where role = 'system_admin'
             and status = 'active' limit 1) as sysadmin,
          (select id from public.profiles where role = 'company_admin'
             and status = 'active' and company_id = (select id from c) limit 1) as admin,
          (select id from public.profiles where role = 'team_member'
             and status = 'active' and company_id = (select id from c) limit 1) as member,
          (select id from public.profiles where role = 'team_member' and status = 'active'
             and company_id = (select id from c)
             and id <> (select id from public.profiles where role = 'team_member'
                         and status = 'active' and company_id = (select id from c) limit 1)
           limit 1) as colleague,
          (select id from public.profiles where company_id is not null
             and company_id <> (select id from c) limit 1) as outsider;`,
      probes: [
        // profiles_update_self: you may edit yourself, and you may not
        // change what you ARE while doing it.
        {
          name: "member edits their own name",
          caller: "member",
          sql: "with u as (update public.profiles set full_name = full_name where id = '$member' returning id) select count(*)::int as n from u;",
          expect: "1",
        },
        {
          name: "member promotes THEMSELVES to system_admin",
          caller: "member",
          sql: "with u as (update public.profiles set role = 'system_admin' where id = '$member' returning id) select count(*)::int as n from u;",
          expect: "42501",
        },
        {
          name: "member moves THEMSELVES to another company",
          caller: "member",
          sql: "with u as (update public.profiles set company_id = null where id = '$member' returning id) select count(*)::int as n from u;",
          expect: "42501",
        },
        {
          name: "member edits a colleague",
          caller: "member",
          sql: "with u as (update public.profiles set full_name = full_name where id = '$colleague' returning id) select count(*)::int as n from u;",
          expect: "0",
          provenBy: "admin",
        },
        // profiles_update_company_admin: its own company, not itself,
        // and not into a role it does not hold.
        {
          name: "company_admin edits a member of its company",
          caller: "admin",
          sql: "with u as (update public.profiles set full_name = full_name where id = '$member' returning id) select count(*)::int as n from u;",
          expect: "1",
        },
        {
          name: "company_admin promotes a member to system_admin",
          caller: "admin",
          sql: "with u as (update public.profiles set role = 'system_admin' where id = '$member' returning id) select count(*)::int as n from u;",
          expect: "42501",
        },
        {
          name: "company_admin edits someone in another company",
          caller: "admin",
          sql: "with u as (update public.profiles set full_name = full_name where id = '$outsider' returning id) select count(*)::int as n from u;",
          expect: "0",
          provenBy: "sysadmin",
        },
        {
          // Deletes a REAL colleague rather than a seeded one:
          // profiles.id is foreign-keyed to auth.users, so a probe
          // cannot invent a person. Rolled back with everything else.
          name: "company_admin deletes a member of its company",
          caller: "admin",
          sql: "with d as (delete from public.profiles where id = '$colleague' returning id) select count(*)::int as n from d;",
          expect: "1",
        },
        // guide_assignments: a guide sees their own rows, nobody else's.
        {
          name: "team member reads guide assignments",
          caller: "member",
          sql: "select count(*)::int as n from public.guide_assignments;",
          expect: "0",
          provenBy: "sysadmin",
        },
        // The entitlement history decision from 2026-09-13: company
        // admins stay without read on company_feature_events.
        {
          name: "company_admin reads entitlement history",
          caller: "admin",
          sql: "select count(*)::int as n from public.company_feature_events;",
          expect: "0",
          provenBy: "sysadmin",
        },
      ],
    },
  },
];

// The company each row of a table belongs to, one row per row.
//
// No id column is assumed: company_features has none, and a helper
// that quietly requires one would take the batch that is already
// deployed with it.
export function companyOfRowSql(batch: Batch, table: string): string {
  const custom = batch.indirectScope?.[table];
  if (custom) return `select company_id from (${custom.rows}) t`;
  if (table === "companies") return "select id as company_id from public.companies";
  return `select company_id from public.${table}`;
}

// Candidate control callers, company-scoped ones first.
//
// A control has to be someone the table's READ policy actually
// admits. transcript_sources does not admit a plain team_member at
// all and the audit log admits nobody but system_admin, so the
// member-shaped control that worked for four batches reports zero on
// them — correctly, and uselessly. These are tried in order and the
// first that can actually see rows is used, which is stated in the
// result so nobody reads "control sees 4" as "a member sees 4".
export function controlCandidatesSql(batch: Batch, table: string): string {
  const rows = companyOfRowSql(batch, table);
  // Explicitly a few of each role rather than one ordered list with a
  // limit. The first version took the first twelve by rank and never
  // reached the system_admin, because the companies holding
  // transcript_sources have more than twelve team members between
  // them — so a table only a system_admin can read reported its
  // control as unable to read it.
  return (
    `with c as (select distinct company_id from (${rows}) t where company_id is not null) ` +
    `(select p.id, p.role, p.company_id, 1 as rank from public.profiles p ` +
    ` where p.status = 'active' and p.role = 'team_member' ` +
    `   and p.company_id in (select company_id from c) limit 4) ` +
    `union all ` +
    `(select p.id, p.role, p.company_id, 2 as rank from public.profiles p ` +
    ` where p.status = 'active' and p.role = 'company_admin' ` +
    `   and p.company_id in (select company_id from c) limit 4) ` +
    `union all ` +
    `(select p.id, p.role, p.company_id, 3 as rank from public.profiles p ` +
    ` where p.status = 'active' and p.role = 'system_admin' limit 1) ` +
    `order by rank;`
  );
}

// A control caller whose company actually has rows in THIS table.
//
// loadIdentities picks one member for the whole run, which is fine
// until a batch reaches a table that member's company has nothing in.
// Batch 4 did: success_measure_entries and csf_kpi_links both reported
// NOT PROVEN because the control saw zero, which is the harness
// working — a control that sees nothing controls nothing — and also a
// check that cannot run. So the control is chosen per table, the same
// way the other company is.
export function memberForTableSql(batch: Batch, table: string): string {
  return (
    `select p.id as member, p.company_id as company ` +
    `from public.profiles p ` +
    `where p.role = 'team_member' and p.status = 'active' ` +
    `and p.company_id is not null ` +
    `and p.company_id in (select company_id from (${companyOfRowSql(batch, table)}) t) ` +
    `limit 1;`
  );
}

// The other company has to HAVE rows, or "sees 0 of B" is not a
// denial.
//
// This is the deleted-user check's control, applied to isolation. The
// first version asserted own > 0 and other = 0 and called that a
// tenant boundary. On batch 2 the arbitrary "other company" held zero
// commitment_occurrences, so that half passed against an empty set
// and would have passed with every policy on the table dropped.
// Measured, not reasoned: the traversal returned other = 0 whichever
// way it was written, because there was nothing there to return.
export function otherCompanySql(batch: Batch, table: string, own: string): string {
  return (
    `select company_id as other, count(*)::int as n ` +
    `from (${companyOfRowSql(batch, table)}) t ` +
    `where company_id is not null and company_id <> '${own}' ` +
    `group by company_id order by count(*) desc limit 1;`
  );
}

// Direct tables name their column. A table with no company of its own
// has both scope sets materialised as postgres first, granted to the
// caller, and counted under the caller's policies — the traversal
// must not run as the caller, or the parent's policy would be doing
// the filtering the child's policy is supposed to be doing.
//
// Both halves are always reported, whichever path.
export function isolationSql(
  batch: Batch,
  table: string,
  own: string,
  other: string
): { setup: string; assertion: string } {
  const traversal = batch.indirectScope?.[table];
  if (!traversal) {
    const col = table === "companies" ? "id" : "company_id";
    return {
      setup: "",
      assertion:
        `select (select count(*) from public.${table} where ${col} = '${own}')::int as own, ` +
        `(select count(*) from public.${table} where ${col} = '${other}')::int as other_;`,
    };
  }
  return {
    setup:
      `create temp table _scope_own as select key from (${traversal.rows}) t where company_id = '${own}';\n` +
      `create temp table _scope_other as select key from (${traversal.rows}) t where company_id = '${other}';\n` +
      "grant select on _scope_own, _scope_other to authenticated;",
    assertion:
      `select (select count(*) from public.${table} where ${traversal.key} in (select key from _scope_own))::int as own, ` +
      `(select count(*) from public.${table} where ${traversal.key} in (select key from _scope_other))::int as other_;`,
  };
}

export function findBatch(n: string): Batch | null {
  return BATCHES.find((b) => b.n === n) ?? null;
}

// ---- The static check ------------------------------------------
//
// IS NOT DISTINCT FROM is forbidden in tenant-scoping policies. It
// turns deny into allow exactly where it matters: a caller with no
// company (every system_admin, every aims_guide) compared against a
// row with no company (an unrouted meeting) matches, and `=` does
// not. Hazard 1 demonstrates it.
//
// Enforced over LIVE policy text rather than migration text, because
// the two disagree: policies are dropped and recreated, and the file
// that last mentioned a policy is not necessarily the one that
// defines it now.
//
// Migration 0164 is a loaded precedent. Someone looking for house
// style finds a legitimate use of the idiom and copies it into a
// tenant comparison, where it is a hole. This check is what disarms
// that, which is why the allowlist names the one policy rather than
// the idiom being merely discouraged.
export const NOT_DISTINCT_ALLOWLIST: readonly string[] = [
  // A self-update that pins the caller's own company_id to the value
  // it already holds. For a system_admin both sides are legitimately
  // NULL, and `=` would make the row unwritable. Not a tenant
  // comparison: it compares the caller to themselves. See 0164.
  //
  // It is also this check's CANARY. It is the one policy known to use
  // the idiom, so if the matcher stops finding it, the matcher is
  // broken rather than the schema being clean. See canaryPresent
  // below.
  "profiles.profiles_update_self",
];

export type PolicyRow = {
  tablename: string;
  policyname: string;
  qual: string | null;
  with_check: string | null;
};

// MATCHES THE DEPARSED SPELLING, NOT THE ONE PEOPLE TYPE.
//
// Postgres does not store policy text. It stores a parse tree and
// renders it back, and `a is not distinct from b` comes out of
// pg_policies as `NOT (a IS DISTINCT FROM b)`. A matcher looking for
// the source spelling finds nothing on a live database, including the
// one policy known to use it, and reports a clean pass.
//
// That is not hypothetical: the first version of this check did
// exactly that and went green against a schema that contains the
// idiom. It was caught by the canary below, which is why the canary
// is part of the check and not a comment asking someone to be careful.
//
// So the matcher covers both spellings: `IS DISTINCT FROM` as
// deparsed, and `IS NOT DISTINCT FROM` as typed, since policy text
// also reaches this check from migration files during review. It
// catches the bare form too, which is equally wrong in a tenant
// predicate: `company_id IS DISTINCT FROM <caller>` admits every row
// belonging to somebody else.
const DISTINCT_FROM = /is\s+(?:not\s+)?distinct\s+from/i;

export function notDistinctMatches(rows: readonly PolicyRow[]): string[] {
  return rows
    .filter((r) => DISTINCT_FROM.test(`${r.qual ?? ""} ${r.with_check ?? ""}`))
    .map((r) => `${r.tablename}.${r.policyname}`);
}

export function notDistinctOffenders(rows: readonly PolicyRow[]): string[] {
  return notDistinctMatches(rows).filter(
    (name) => !NOT_DISTINCT_ALLOWLIST.includes(name)
  );
}

// True when at least one allowlisted policy was actually matched. A
// check that matches nothing at all cannot tell a clean schema from a
// broken matcher, and the allowlist is the only place we know the
// idiom is present on purpose.
export function canaryPresent(matches: readonly string[]): boolean {
  return NOT_DISTINCT_ALLOWLIST.some((name) => matches.includes(name));
}

async function staticCheck(run: Runner): Promise<BatchCheck> {
  const rows = await run<PolicyRow>(`
    select tablename, policyname, qual, with_check
      from pg_policies where schemaname = 'public'
     order by tablename, policyname;`);
  const matches = notDistinctMatches(rows);
  const offenders = notDistinctOffenders(rows);
  const canary = canaryPresent(matches);
  const ok = offenders.length === 0 && canary;
  return {
    name: "static IS DISTINCT FROM",
    before: `${rows.length} live policies, ${matches.length} use the idiom`,
    after: !canary
      ? "CHECK IS BROKEN: matched no allowlisted policy"
      : offenders.length === 0
        ? `all ${matches.length} allowlisted (${matches.join(", ")})`
        : `NOT allowlisted: ${offenders.join(", ")}`,
    ok,
    detail: !canary
      ? "the one policy known to use the idiom was not matched, so a clean result proves nothing"
      : offenders.length === 0
        ? "no tenant-scoping policy compares with IS DISTINCT FROM"
        : "a policy outside the allowlist compares with IS DISTINCT FROM",
  };
}

// ---- Batch acceptance ------------------------------------------
//
// Everything below runs against the REAL tables in the batch, as real
// callers, with the batch's migration applied inside the transaction
// and rolled back after. The before/after pair is the point: a check
// that only ever sees the rewritten policies cannot tell you whether
// it would have caught the old ones failing.
export type BatchCheck = {
  name: string;
  before: string;
  after: string;
  ok: boolean;
  detail: string;
};

export function batchSummaryLines(
  checks: readonly BatchCheck[],
  label: string
): string[] {
  const lines = ["", `  ${label}`, ""];
  for (const c of checks) {
    lines.push(
      `  ${(c.ok ? "PASS" : "FAIL").padEnd(6)}${c.name.padEnd(64)}${c.detail}`
    );
    lines.push(`  ${"".padEnd(6)}${"".padEnd(64)}before: ${c.before}`);
    lines.push(`  ${"".padEnd(6)}${"".padEnd(64)}after:  ${c.after}`);
  }
  const failed = checks.filter((c) => !c.ok).length;
  lines.push("");
  lines.push(
    `  ${checks.length} check${checks.length === 1 ? "" : "s"}: ` +
      `${checks.length - failed} pass, ${failed} fail`
  );
  lines.push("");
  return lines;
}

function migrationSql(batch: Batch): string {
  return readFileSync(`supabase/migrations/${batch.migration}`, "utf8");
}

// As the connection's own role, with no JWT. postgres owns these
// tables and bypasses RLS, so its plan carries no policy filter at
// all — that is the baseline the other two are read against, not a
// tenant check.
function asPostgres(setup: string, assertion: string): string {
  return ["begin;", setup, assertion, "rollback;"].join("\n");
}

// A deleted user's still-valid JWT: a `sub` that matches no profiles
// row. auth_profile() returns zero rows, so the exists form is false
// and the hoisted form is NULL. Both deny, and the point of asserting
// it per table is that NULL only stays a denial while nothing
// composes it with a coalesce, a negation, or a NULL branch beside a
// non-NULL one.
//
// The control matters as much as the assertion. Zero rows for a
// deleted user proves nothing on its own: a table the caller could
// never read, or a table with no rows, returns zero too. So every
// table reports what an ordinary member of a real company sees
// through the same policies, and the check fails as NOT PROVEN if
// that control is also zero.
async function deletedUserChecks(
  run: Runner,
  ids: Identities,
  batch: Batch
): Promise<BatchCheck[]> {
  const sql = migrationSql(batch);
  const out: BatchCheck[] = [];
  for (const table of batch.tables) {
    const count = "select (select count(*) from public." + table + ")::int as n;";
    // A control the table's read policy actually admits, tried
    // company-scoped first.
    const candidates = await run<{ id: string; role: string }>(
      controlCandidatesSql(batch, table)
    );
    // If the batch knows how to make a row here, use it: a table that
    // happens to be empty on this clone would otherwise report every
    // caller as unable to read it, which proves nothing either way.
    const seed =
      batch.seedRows?.[table] ?? batch.nullCompanyRows?.[table] ?? "";
    const withSeed = [sql, seed].filter(Boolean).join("\n");
    let control = { n: 0 };
    let controlRole = "none";
    for (const candidate of candidates) {
      const [seen] = await run<{ n: number }>(
        asCaller(candidate.id, withSeed, count)
      );
      if (seen.n > 0) {
        control = seen;
        controlRole = candidate.role;
        break;
      }
    }
    const [before] = await run<{ n: number }>(asCaller(ids.nobody, seed, count));
    const [after] = await run<{ n: number }>(asCaller(ids.nobody, withSeed, count));
    const proven = control.n > 0;
    const ok = before.n === 0 && after.n === 0 && proven;
    out.push({
      name: `deleted user · ${table}`,
      before: `${before.n} row(s)`,
      after: `${after.n} row(s), control ${controlRole} sees ${control.n}`,
      ok,
      detail: ok
        ? "denied before and after, and the control caller can read the table"
        : !proven
          ? "NOT PROVEN: the control caller also sees 0 rows, so this zero is not evidence"
          : "a caller with no profile row can read this table",
    });
  }
  return out;
}

// Isolation acceptance, per batch rather than once at the end: a
// member of company A cannot read company B's rows through the
// rewritten policies, asserted with a real JWT against the real
// table.
//
// Both halves are reported. "Sees 0 of B" is only meaningful beside
// "sees N of A" through the same policy in the same transaction: a
// policy that denies everything satisfies the first and is a broken
// tenant boundary, not a working one.
async function isolationChecks(
  run: Runner,
  ids: Identities,
  batch: Batch
): Promise<BatchCheck[]> {
  const sql = migrationSql(batch);
  const out: BatchCheck[] = [];
  for (const table of batch.tables) {
    // Chosen per table rather than once, because "another company"
    // is only useful if it has rows in THIS table.
    // Isolation needs a COMPANY-SCOPED reader: "sees 0 of B" means
    // nothing said by a system_admin, who is admitted to everything.
    // Where no such role may read the table at all — the audit log is
    // system_admin only — tenant isolation is not the mechanism
    // protecting it, and the case says so instead of failing.
    const candidates = (
      await run<{ id: string; role: string; company_id: string | null }>(
        controlCandidatesSql(batch, table)
      )
    ).filter((c) => c.role !== "system_admin" && c.company_id);
    let caller: string | null = null;
    let callerCompany: string | null = null;
    let callerRole = "none";
    for (const candidate of candidates) {
      const probe = `select (select count(*) from public.${table})::int as n;`;
      const [seen] = await run<{ n: number }>(asCaller(candidate.id, sql, probe));
      if (seen.n > 0) {
        caller = candidate.id;
        callerCompany = candidate.company_id;
        callerRole = candidate.role;
        break;
      }
    }
    if (!caller || !callerCompany) {
      out.push({
        name: `isolation · ${table}`,
        before: "does not apply",
        after: "does not apply",
        ok: true,
        detail:
          "no company-scoped role may read this table, so tenant isolation " +
          "is not what protects it — see the deleted-user and nullable cases",
      });
      continue;
    }
    // A sparse table gets its second tenant made rather than found.
    // The seed runs inside a rolled-back transaction for the pick and
    // again inside the measurement; being deterministic is what makes
    // those the same company.
    const isoSeed = batch.isolationSeed?.[table] ?? "";
    const pickSql = otherCompanySql(batch, table, callerCompany);
    const [pick] = await run<{ other: string | null; n: number }>(
      isoSeed
        ? ["begin;", sql, isoSeed, pickSql, "rollback;"].join("\n")
        : pickSql
    );
    if (!pick?.other) {
      out.push({
        name: `isolation · ${table}`,
        before: "not run",
        after: "not run",
        ok: false,
        detail:
          "NOT PROVEN: no company other than the caller's has any row in " +
          "this table, so there is nothing a denial could be denying",
      });
      continue;
    }
    const { setup, assertion: counts } = isolationSql(
      batch,
      table,
      callerCompany,
      pick.other
    );
    const [before] = await run<{ own: number; other_: number }>(
      asCaller(caller, [isoSeed, setup].filter(Boolean).join("\n"), counts)
    );
    const [after] = await run<{ own: number; other_: number }>(
      asCaller(caller, [sql, isoSeed, setup].filter(Boolean).join("\n"), counts)
    );
    const ok = after.other_ === 0 && after.own > 0 && before.other_ === 0;
    out.push({
      name: `isolation · ${table}`,
      before: `own ${before.own}, other ${before.other_}`,
      after: `own ${after.own}, other ${after.other_} (of ${pick.n} that exist)`,
      ok,
      detail: ok
        ? `${callerRole} reads its own company, denied the other's ${pick.n}`
        : after.own === 0
          ? "NOT PROVEN: the caller sees none of its OWN company either, so the denial is not evidence"
          : "a member of one company can read another company's rows",
    });
  }
  return out;
}

// Hazard 1 applies only where a company_id can be NULL on BOTH sides.
// Reported rather than skipped: a batch with no nullable column has
// to say so, because "the case did not run" and "the case passed"
// look identical in a summary that omits it.
async function nullableCompanyChecks(
  run: Runner,
  ids: Identities,
  batch: Batch
): Promise<BatchCheck[]> {
  const cols = await run<{ table_name: string; column_name: string }>(`
    select table_name, column_name
      from information_schema.columns
     where table_schema = 'public'
       and table_name in (${batch.tables.map((t) => `'${t}'`).join(",")})
       and column_name = 'company_id'
       and is_nullable = 'YES'
     order by table_name;`);

  if (cols.length === 0) {
    return [
      {
        name: "nullable company_id",
        before: `${batch.tables.length} tables in the batch`,
        after: "0 carry a nullable company_id",
        ok: true,
        detail:
          "the case does not apply to this batch: no NULL-to-NULL pair can exist",
      },
    ];
  }

  const sql = migrationSql(batch);
  const out: BatchCheck[] = [];

  // The caller must have no company AND no privilege. ids.noCompany is
  // whichever company-less profile the run found first, and on this
  // fleet that is a system_admin — who is SUPPOSED to see an unrouted
  // meeting, so asserting zero of them would be asserting a bug. An
  // aims_guide is the honest caller: no company, and admitted to a row
  // only through is_guide_for(company_id), which is false when that
  // company_id is NULL.
  const [guide] = await run<{ id: string | null }>(
    `select id from public.profiles
      where role = 'aims_guide' and status = 'active'
        and company_id is null limit 1;`
  );

  for (const { table_name: table } of cols) {
    const exclude = batch.nullCompanyExclude?.[table];
    const count =
      `select (select count(*) from public.${table} where company_id is null` +
      (exclude ? ` and (${exclude})` : "") +
      `)::int as n;`;
    const seed = batch.nullCompanyRows?.[table];

    if (!guide?.id) {
      out.push({
        name: `nullable company_id · ${table}`,
        before: "not run",
        after: "not run",
        ok: false,
        detail:
          "NOT PROVEN: this clone has no company-less aims_guide, and a " +
          "system_admin is admitted to these rows on purpose",
      });
      continue;
    }
    const withSeed = [sql, seed].filter(Boolean).join("\n");
    const [before] = await run<{ n: number }>(
      asCaller(guide.id, seed ?? "", count)
    );
    const [after] = await run<{ n: number }>(
      asCaller(guide.id, withSeed, count)
    );
    // The control: the row is really there and someone can see it.
    const [control] = await run<{ n: number }>(
      asCaller(ids.systemAdmin, withSeed, count)
    );
    const proven = control.n > 0;
    const ok = before.n === 0 && after.n === 0 && proven;
    out.push({
      name: `nullable company_id · ${table}`,
      before: `${before.n} NULL-company row(s) visible`,
      after: `${after.n} visible, system_admin sees ${control.n}`,
      ok,
      detail: ok
        ? "a company-less guide reads no NULL-company row, and the row is really there"
        : !proven
          ? "NOT PROVEN: the system_admin control sees none either, so the seed did not land"
          : "a caller with no company can read NULL-company rows",
    });
  }
  return out;
}

// ---- Write probes ----------------------------------------------

// Substitution is deliberately strict: an unresolved $name is a
// programming error that would otherwise reach Postgres as literal
// text and come back as a confusing syntax error.
export function fillProbe(
  sql: string,
  fixtures: Record<string, string | null>
): { sql: string; missing: string[] } {
  const missing: string[] = [];
  const filled = sql.replace(/\$([a-z_]+)/g, (_m, name: string) => {
    const value = fixtures[name];
    if (!value) {
      missing.push(name);
      return "";
    }
    return value;
  });
  return { sql: filled, missing };
}

export function probeVerdict(opts: {
  before: string;
  after: string;
  expect: string;
  expectBefore?: string;
  control?: string;
}): { ok: boolean; detail: string } {
  const { before, after, expect, expectBefore, control } = opts;
  if (expectBefore !== undefined) {
    if (before !== expectBefore) {
      return {
        ok: false,
        detail: `expected the before to be ${expectBefore}, got ${before}`,
      };
    }
    if (after !== expect) {
      return { ok: false, detail: `expected ${expect} after, got ${after}` };
    }
    return {
      ok: true,
      detail: `moved ${expectBefore} → ${after}, as this migration intends`,
    };
  }
  if (before !== after) {
    return { ok: false, detail: "SEMANTICS MOVED: before and after disagree" };
  }
  if (after !== expect) {
    return { ok: false, detail: `expected ${expect}, got ${after}` };
  }
  // A zero has to be a zero OF something. Without the control it is
  // indistinguishable from a missing row or a mistyped column, both of
  // which have already happened while writing these.
  if (expect === "0" && control !== undefined && control === "0") {
    return {
      ok: false,
      detail:
        "NOT PROVEN: the control caller also got 0, so this zero is not a denial",
    };
  }
  return {
    ok: true,
    detail: control !== undefined ? `denied; control caller got ${control}` : "as expected",
  };
}

async function writeProbeChecks(
  run: Runner,
  batch: Batch
): Promise<BatchCheck[]> {
  const spec = batch.writeProbes;
  if (!spec) return [];
  const sql = migrationSql(batch);
  const [fixtures] = await run<Record<string, string | null>>(spec.fixtures);
  const out: BatchCheck[] = [];

  const runAs = async (
    callerId: string,
    setup: string,
    statement: string
  ): Promise<string> => {
    try {
      const rows = await run<{ n: number }>(asCaller(callerId, setup, statement));
      return String(rows?.[0]?.n ?? 0);
    } catch (error) {
      const text = String((error as Error).message ?? error);
      const code = text.match(/ERROR:\s+(\d+)/);
      return code ? code[1] : "ERROR";
    }
  };

  for (const probe of spec.probes) {
    const caller = fixtures?.[probe.caller] ?? null;
    const { sql: statement, missing } = fillProbe(probe.sql, fixtures ?? {});
    const absent = [...missing, ...(caller ? [] : [probe.caller])];
    if (absent.length > 0) {
      out.push({
        name: `write · ${probe.name}`,
        before: "not run",
        after: "not run",
        ok: false,
        detail:
          `NOT PROVEN: this clone has no ${absent.join(", ")}. A probe ` +
          "against a missing row returns 0 and reads like a denial.",
      });
      continue;
    }
    const { sql: setup } = probe.setup
      ? fillProbe(probe.setup, fixtures ?? {})
      : { sql: "" };
    const before = await runAs(caller as string, setup, statement);
    const after = await runAs(
      caller as string,
      [sql, setup].filter(Boolean).join("\n"),
      statement
    );
    const control = probe.provenBy
      ? await runAs(
          fixtures?.[probe.provenBy] as string,
          [sql, setup].filter(Boolean).join("\n"),
          statement
        )
      : undefined;
    const { ok, detail } = probeVerdict({
      before,
      after,
      expect: probe.expect,
      expectBefore: probe.expectBefore,
      control,
    });
    out.push({
      name: `write · ${probe.name}`,
      before,
      after: control !== undefined ? `${after} (control ${control})` : after,
      ok,
      detail,
    });
  }
  return out;
}

// ---- The batch EXPLAIN pair ------------------------------------
//
// Three caller classes, before and after, per table. The same three
// F11 measured, for the same reason: the cost is not uniform across
// callers. A system_admin's predicate short-circuits on its first
// branch and a company member's does not, which is why the people
// paying for the un-hoisted form are clients rather than staff.
//
// These tables are small on the clone (tens of rows), so the timings
// here are not the magnitude evidence — the 5000-row measurement
// under --explain is. What these show is the SHAPE: a per-row SubPlan
// before, an InitPlan after, on the real policies.
async function batchExplain(
  run: Runner,
  ids: Identities,
  batch: Batch
): Promise<{ lines: string[]; ok: boolean }> {
  const sql = migrationSql(batch);
  const callers: Array<[string, string | null]> = [
    ["postgres", null],
    ["system_admin", ids.systemAdmin],
    ["company member", ids.member],
  ];

  const lines: string[] = [];
  let ok = true;

  for (const table of batch.tables) {
    const [{ n: rows }] = await run<{ n: number }>(
      `select count(*)::int as n from public.${table};`
    );
    lines.push(`  ${table} (${rows} rows)`);
    const explain = `explain (analyze, costs off) select count(*) from public.${table};`;

    for (const [label, sub] of callers) {
      const read = async (setup: string): Promise<PlanFacts> => {
        const stmt =
          sub === null ? asPostgres(setup, explain) : asCaller(sub, setup, explain);
        const plan = await run<Record<string, string>>(stmt);
        return planFacts(
          plan.map((r) => Object.values(r)[0]).filter(Boolean).join("\n")
        );
      };
      const before = await read("");
      const after = await read(sql);

      // postgres bypasses RLS, so neither plan carries a policy
      // filter and the stop condition does not apply to it. It is
      // here as the no-policy baseline.
      const judged = sub !== null && batch.judgesHoist !== false;
      const pass = !judged || afterPlanIsHoisted(after);
      if (!pass) ok = false;

      const fmt = (f: PlanFacts) =>
        `InitPlan=${f.initPlan ? "yes" : "no "}  auth_profile loops=${String(f.loops).padEnd(11)} ` +
        `SubPlans=${f.subPlans}  ${f.ms} ms`;
      lines.push(`    ${label.padEnd(15)} before  ${fmt(before)}`);
      lines.push(
        `    ${"".padEnd(15)} after   ${fmt(after)}${judged ? (pass ? "" : "   <-- STOP CONDITION") : "   (RLS bypassed)"}`
      );
      if (before.filter) lines.push(`        before filter: ${before.filter.slice(0, 118)}`);
      if (after.filter) lines.push(`        after  filter: ${after.filter.slice(0, 118)}`);
    }
    lines.push("");
  }
  return { lines, ok };
}

// ---- Grant probes ----------------------------------------------
//
// THE RULE THIS ENFORCES (docs/failure-modes.md E5): a role widening
// in a server action must ship with its matching RLS change, and
// every granted write gets a probe here, exercised AS THAT ROLE.
//
// App guards are courtesy. RLS is the boundary. The industry field is
// the worked example: setCompanyIndustryAction admitted company_admin
// and aims_guide from commit 5f43059 onward, companies_update admitted
// neither, and for the whole life of the feature the field rendered,
// accepted typing, and failed on every save. Unit tests could not see
// it — they do not run Postgres — and nothing else looked.
//
// A probe asserts BOTH halves of a grant, always:
//
//   granted  — the write the role is supposed to be able to make,
//              which must actually change a row
//   withheld — a write the SAME role must still be refused
//
// The second is what makes the first mean something. "The update
// succeeded" is equally true of a correct narrow grant and of a
// policy that admits everything, and those two are the same line in a
// summary that reports only the success.
export type GrantProbe = {
  name: string;
  granted: string;
  withheld: string;
  ok: boolean;
  detail: string;
};

export function grantSummaryLines(probes: readonly GrantProbe[]): string[] {
  const lines = ["", "  Grant probes — every granted write, exercised as that role", ""];
  for (const p of probes) {
    lines.push(
      `  ${(p.ok ? "PASS" : "FAIL").padEnd(6)}${p.name.padEnd(38)}${p.detail}`
    );
    lines.push(`  ${"".padEnd(6)}${"".padEnd(38)}granted:  ${p.granted}`);
    lines.push(`  ${"".padEnd(6)}${"".padEnd(38)}withheld: ${p.withheld}`);
  }
  const failed = probes.filter((p) => !p.ok).length;
  lines.push("");
  lines.push(
    `  ${probes.length} probe${probes.length === 1 ? "" : "s"}: ` +
      `${probes.length - failed} pass, ${failed} fail`
  );
  lines.push("");
  return lines;
}

// A statement's outcome, flattened so a denial and a raise are
// distinguishable in one string. RLS refuses an UPDATE by matching no
// rows, and the column guard refuses one by raising, and a probe has
// to be able to tell those apart from each other and from success.
export type WriteOutcome = string;

export function describeOutcome(rows: unknown[] | null, error?: unknown): WriteOutcome {
  if (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (/insufficient_privilege|Only industry may be changed/i.test(msg)) {
      return "refused by the column guard";
    }
    if (/row-level security/i.test(msg)) return "refused by RLS";
    return `ERROR: ${msg.replace(/\s+/g, " ").slice(0, 70)}`;
  }
  const n = (rows ?? []).length;
  return n === 0 ? "0 rows (refused by RLS)" : `${n} row(s) written`;
}

async function grantProbes(
  run: Runner,
  ids: Identities,
  pending: string
): Promise<GrantProbe[]> {
  const attempt = async (sub: string, stmt: string): Promise<WriteOutcome> => {
    try {
      const rows = await run<Record<string, unknown>>(asCaller(sub, pending, stmt));
      return describeOutcome(rows);
    } catch (err) {
      return describeOutcome(null, err);
    }
  };

  const setIndustry = (company: string) =>
    `update public.companies set industry = 'harness probe' where id = '${company}' returning id;`;
  const setStatus = (company: string) =>
    `update public.companies set status = 'archived' where id = '${company}' returning id;`;

  const probes: GrantProbe[] = [];

  // The two roles the grant is for, each against a company they hold.
  for (const [label, sub, own] of [
    ["company_admin", ids.companyAdmin, ids.companyAdminCompany],
    ["aims_guide", ids.guide, ids.guideCompany],
  ] as const) {
    const granted = await attempt(sub, setIndustry(own));
    // Same role, same row, a column they were not granted. This is
    // the half that proves the grant is a column grant and not a
    // company admin who can archive their own tenant.
    const otherColumn = await attempt(sub, setStatus(own));
    // Same role, same column, a company that is not theirs. The
    // tenant boundary has to survive the widening.
    const otherCompany = await attempt(sub, setIndustry(ids.otherCompany));

    const ok =
      granted.includes("row(s) written") &&
      otherColumn === "refused by the column guard" &&
      otherCompany.startsWith("0 rows");

    probes.push({
      name: `industry grant · ${label}`,
      granted: `industry on own company: ${granted}`,
      withheld: `status on own company: ${otherColumn} | industry on another company: ${otherCompany}`,
      ok,
      detail: ok
        ? "can set industry where entitled, and nothing else"
        : !granted.includes("row(s) written")
          ? "THE GRANT DOES NOT WORK: the role cannot make the write the action offers it"
          : "the grant is wider than intended",
    });
  }

  // The control. The column guard is scoped by role, and the way that
  // goes wrong is by applying to everyone — which would take `status`
  // away from system_admin and break archiving fleet-wide. A probe
  // that only watched the two granted roles would not see it.
  const sysStatus = await attempt(ids.systemAdmin, setStatus(ids.otherCompany));
  probes.push({
    name: "column guard · system_admin",
    granted: `status on any company: ${sysStatus}`,
    withheld: "nothing — system_admin is deliberately unconstrained here",
    ok: sysStatus.includes("row(s) written"),
    detail: sysStatus.includes("row(s) written")
      ? "the column guard does not apply to system_admin"
      : "THE COLUMN GUARD IS TOO WIDE: it is constraining system_admin too",
  });

  return probes;
}

export function parseArgs(argv: string[]): {
  only: string | null;
  explain: boolean;
  batch: string | null;
  pending: string | null;
} {
  let only: string | null = null;
  let explain = false;
  let batch: string | null = null;
  let pending: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--case") {
      only = argv[i + 1] ?? null;
      i += 1;
      if (!only) fail("--case needs a name.");
    } else if (argv[i] === "--explain") {
      explain = true;
    } else if (argv[i] === "--batch") {
      batch = argv[i + 1] ?? null;
      i += 1;
      if (!batch) fail("--batch needs a number.");
      if (!findBatch(batch)) {
        fail(
          `No batch "${batch}". Known: ${BATCHES.map((b) => b.n).join(", ")}. ` +
            `A batch is added to BATCHES in this file when its PR is written.`
        );
      }
    } else if (argv[i] === "--pending") {
      pending = argv[i + 1] ?? null;
      i += 1;
      if (!pending) fail("--pending needs a migration filename.");
      // Comma-separated and applied in the order given. A migration
      // usually depends on the one before it — 0176's policies call
      // helpers 0175 creates — and a clone that is behind the fleet
      // has neither, so probing an undeployed grant means applying
      // the whole pending run, not just its last file.
      if (pending.split(",").some((f) => !f.trim().endsWith(".sql"))) {
        fail("--pending takes .sql filenames, comma-separated, in apply order.");
      }
    } else {
      fail(
        `Unknown option "${argv[i]}". Options: --case <name>, --explain, ` +
          `--batch <n>, --pending <migration.sql>.`
      );
    }
  }
  return { only, explain, batch, pending };
}

async function main(): Promise<void> {
  const { only, explain, batch, pending } = parseArgs(process.argv.slice(2));
  const target = resolveTarget(process.env);
  const token = process.env.SUPABASE_MANAGEMENT_TOKEN;
  if (!token) {
    fail(
      "SUPABASE_MANAGEMENT_TOKEN is not set. It lives in .env.provisioning. " +
        "See .env.provisioning.example."
    );
  }

  const mgmt = createManagementClient({ token });

  // The Management API rate-limits, and the write probes roughly
  // doubled the query count per batch. A 429 is a pause, not a
  // result: retrying it is the difference between a harness that
  // reports on the policies and one that reports on how fast it was
  // asked. Only 429 is retried — every other failure is an answer.
  const run: Runner = async (sql) => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await mgmt.runQuery(target, sql);
      } catch (error) {
        const status = (error as { status?: number }).status;
        // A 429 is a pause. So is a dropped connection: the query
        // never reached a database, so there is no answer to report,
        // and failing the batch on one would make the harness a
        // measure of the network.
        const transient =
          status === 429 || /fetch failed|ETIMEDOUT|ECONNRESET/i.test(String(error));
        if (!transient || attempt >= 6) throw error;
        // Exponential, capped. The limit is a sustained-rate cap, so
        // a few seconds is not enough once a day's runs have spent
        // the budget.
        const waitMs = Math.min(5000 * 2 ** attempt, 60000);
        console.log(`  (rate limited, waiting ${waitMs / 1000}s)`);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
  };

  // --pending applies a migration that is written but not yet
  // deployed inside every probe transaction, so a PR can show its
  // grant working before the migration lands anywhere. Without it the
  // probes read the live schema, which is what makes them a standing
  // guard: they go red if a policy is reverted, and red on a clone
  // that is behind the fleet.
  const pendingSql = pending
    ? pending
        .split(",")
        .map((f) => readFileSync(`supabase/migrations/${f.trim()}`, "utf8"))
        .join("\n")
    : "";

  console.log("");
  console.log(`  RLS hazard harness against ${target} (dev clone)`);
  console.log("  Every case runs inside a transaction that is rolled back.");

  const ids = await loadIdentities(run);
  const cases = [
    ["hazard-1", hazard1],
    ["hazard-2", hazard2],
    ["hazard-3", hazard3],
  ] as const;

  const results: CaseResult[] = [];
  for (const [name, fn] of cases) {
    if (only && !name.startsWith(only)) continue;
    results.push(await fn(run, ids));
  }

  console.log(summaryLines(results).join("\n"));

  // The static check runs on every invocation, not only under
  // --batch. It costs one query, it is the thing standing between a
  // later batch and the idiom in hazard 1, and a check you have to
  // remember to ask for is not enforcement.
  const staticResult = await staticCheck(run);
  console.log(batchSummaryLines([staticResult], "Static check over live policy text").join("\n"));

  // Grant probes run on every invocation for the same reason the
  // static check does: a guard you have to remember to ask for is not
  // a guard. See E5 in docs/failure-modes.md.
  if (pending) {
    console.log(`  Grant probes measured with supabase/migrations/${pending} applied`);
    console.log("  inside each transaction and rolled back with it.");
  }
  const probes = await grantProbes(run, ids, pendingSql);
  console.log(grantSummaryLines(probes).join("\n"));

  let batchOk = true;
  if (batch) {
    const b = findBatch(batch) as Batch;
    console.log(
      `  Batch ${b.n}: ${b.tables.join(", ")}\n` +
        `  Measured with supabase/migrations/${b.migration} applied inside each\n` +
        `  transaction and rolled back with it. The clone is not modified.`
    );

    const checks = [
      ...(await deletedUserChecks(run, ids, b)),
      ...(await isolationChecks(run, ids, b)),
      ...(await nullableCompanyChecks(run, ids, b)),
      ...(await writeProbeChecks(run, b)),
    ];
    console.log(batchSummaryLines(checks, `Batch ${b.n} acceptance`).join("\n"));

    console.log(`  Batch ${b.n} EXPLAIN, three caller classes, before and after`);
    console.log("");
    const { lines, ok } = await batchExplain(run, ids, b);
    console.log(lines.join("\n"));
    batchOk = ok && checks.every((c) => c.ok);
    console.log(
      batchOk
        ? `  Batch ${b.n}: acceptance green, every judged after-plan hoisted.\n`
        : `  Batch ${b.n}: STOP. Do not promote and do not start the next batch.\n`
    );
  }

  if (explain) {
    console.log("  InitPlan measurement — which shape evaluates the helper once");
    console.log((await initPlanMeasurement(run, ids)).join("\n"));
    console.log("");
  }

  if (
    results.some((r) => !r.ok) ||
    !staticResult.ok ||
    probes.some((p) => !p.ok) ||
    !batchOk
  ) {
    process.exit(1);
  }
}

// Runs only when this file IS the process entry point. Importing it
// must never execute it — see scripts/lib/entry-point.ts and the gate
// in scripts/entry-points.test.ts.
if (isEntryPoint(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
