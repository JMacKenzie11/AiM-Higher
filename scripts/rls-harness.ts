/**
 * scripts/rls-harness.ts
 *
 * Runs RLS behaviour tests against a real Postgres, as a real caller.
 *
 * Usage:
 *   npm run rls:hazards            # every case
 *   npm run rls:hazards -- --case hazard-1
 *   npm run rls:hazards -- --explain   # also print the InitPlan measurement
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
  member: string; // an ordinary member of some company
  memberCompany: string;
  otherCompany: string; // a different company, for the isolation case
  nobody: string; // a uuid with no profile row at all
};

async function loadIdentities(run: Runner): Promise<Identities> {
  const [row] = await run<{
    no_company: string | null;
    member: string | null;
    member_company: string | null;
    other_company: string | null;
  }>(`
    select
      (select id from public.profiles
        where company_id is null and status = 'active' limit 1) as no_company,
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

  if (!row?.no_company || !row?.member || !row?.member_company || !row?.other_company) {
    fail(
      "The clone does not carry the identities these cases need: a profile " +
        "with a NULL company_id, an active team_member, and a second " +
        "company. Run `npm run seed:e2e`, or refresh the clone."
    );
  }
  return {
    noCompany: row.no_company,
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
    const initplan = /InitPlan/.test(text);
    const loops = text.match(/auth_profile[^\n]*loops=(\d+)/)?.[1] ?? "not in plan";
    const ms = text.match(/Execution Time: ([\d.]+) ms/)?.[1] ?? "?";
    out.push(
      `  ${label.padEnd(32)} InitPlan=${initplan ? "yes" : "no "}  ` +
        `auth_profile loops=${String(loops).padEnd(11)} ${ms} ms`
    );
    const filter = text.split("\n").find((l) => /Filter:/.test(l));
    if (filter) out.push(`      ${filter.trim().slice(0, 120)}`);
  }
  out.push("");
  return out;
}

export function parseArgs(argv: string[]): { only: string | null; explain: boolean } {
  let only: string | null = null;
  let explain = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--case") {
      only = argv[i + 1] ?? null;
      i += 1;
      if (!only) fail("--case needs a name.");
    } else if (argv[i] === "--explain") {
      explain = true;
    } else {
      fail(`Unknown option "${argv[i]}". Options: --case <name>, --explain.`);
    }
  }
  return { only, explain };
}

async function main(): Promise<void> {
  const { only, explain } = parseArgs(process.argv.slice(2));
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

  if (explain) {
    console.log("  InitPlan measurement — which shape evaluates the helper once");
    console.log((await initPlanMeasurement(run, ids)).join("\n"));
    console.log("");
  }

  if (results.some((r) => !r.ok)) process.exit(1);
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
