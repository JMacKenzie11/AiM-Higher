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
};

async function loadIdentities(run: Runner): Promise<Identities> {
  const [row] = await run<{
    no_company: string | null;
    system_admin: string | null;
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
    !row?.member ||
    !row?.member_company ||
    !row?.other_company
  ) {
    fail(
      "The clone does not carry the identities these cases need: a profile " +
        "with a NULL company_id, an active system_admin, an active " +
        "team_member, and a second company. Run `npm run seed:e2e`, or " +
        "refresh the clone."
    );
  }
  return {
    noCompany: row.no_company,
    systemAdmin: row.system_admin,
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
};

export const BATCHES: readonly Batch[] = [
  {
    n: "1",
    tables: ["companies", "company_features", "quarters"],
    migration: "0175_f8_batch1_hoist.sql",
  },
];

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
      `  ${(c.ok ? "PASS" : "FAIL").padEnd(6)}${c.name.padEnd(38)}${c.detail}`
    );
    lines.push(`  ${"".padEnd(6)}${"".padEnd(38)}before: ${c.before}`);
    lines.push(`  ${"".padEnd(6)}${"".padEnd(38)}after:  ${c.after}`);
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
    const [before] = await run<{ n: number }>(asCaller(ids.nobody, "", count));
    const [after] = await run<{ n: number }>(asCaller(ids.nobody, sql, count));
    const [control] = await run<{ n: number }>(asCaller(ids.member, sql, count));
    const proven = control.n > 0;
    const ok = before.n === 0 && after.n === 0 && proven;
    out.push({
      name: `deleted user · ${table}`,
      before: `${before.n} row(s)`,
      after: `${after.n} row(s), control member sees ${control.n}`,
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
    // companies is keyed by id; everything else in this batch carries
    // a company_id.
    const col = table === "companies" ? "id" : "company_id";
    const counts =
      `select (select count(*) from public.${table} where ${col} = '${ids.memberCompany}')::int as own, ` +
      `(select count(*) from public.${table} where ${col} = '${ids.otherCompany}')::int as other_;`;
    const [before] = await run<{ own: number; other_: number }>(
      asCaller(ids.member, "", counts)
    );
    const [after] = await run<{ own: number; other_: number }>(
      asCaller(ids.member, sql, counts)
    );
    const ok = after.other_ === 0 && after.own > 0 && before.other_ === 0;
    out.push({
      name: `isolation · ${table}`,
      before: `own ${before.own}, other ${before.other_}`,
      after: `own ${after.own}, other ${after.other_}`,
      ok,
      detail: ok
        ? "reads its own company, denied the other"
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
  for (const { table_name: table } of cols) {
    const count =
      `select (select count(*) from public.${table} where company_id is null)::int as n;`;
    const [before] = await run<{ n: number }>(asCaller(ids.noCompany, "", count));
    const [after] = await run<{ n: number }>(asCaller(ids.noCompany, sql, count));
    const ok = before.n === 0 && after.n === 0;
    out.push({
      name: `nullable company_id · ${table}`,
      before: `${before.n} NULL-company row(s) visible`,
      after: `${after.n} NULL-company row(s) visible`,
      ok,
      detail: ok
        ? "a caller with no company reads no NULL-company row"
        : "a caller with no company can read NULL-company rows",
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
      const judged = sub !== null;
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

export function parseArgs(argv: string[]): {
  only: string | null;
  explain: boolean;
  batch: string | null;
} {
  let only: string | null = null;
  let explain = false;
  let batch: string | null = null;
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
    } else {
      fail(
        `Unknown option "${argv[i]}". Options: --case <name>, --explain, --batch <n>.`
      );
    }
  }
  return { only, explain, batch };
}

async function main(): Promise<void> {
  const { only, explain, batch } = parseArgs(process.argv.slice(2));
  const target = resolveTarget(process.env);
  const token = process.env.SUPABASE_MANAGEMENT_TOKEN;
  if (!token) {
    fail(
      "SUPABASE_MANAGEMENT_TOKEN is not set. It lives in .env.provisioning. " +
        "See .env.provisioning.example."
    );
  }

  const mgmt = createManagementClient({ token });
  const run: Runner = (sql) => mgmt.runQuery(target, sql);

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

  if (results.some((r) => !r.ok) || !staticResult.ok || !batchOk) process.exit(1);
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
