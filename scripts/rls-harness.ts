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

import { readFileSync, readdirSync } from "node:fs";

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

// How far the clone lags the repo.
//
// A batch report is evidence, and evidence from a stale instrument is
// worth less than no evidence, because it looks the same. On
// 2026-09-13 the clone sat at 0180 while the fleet reached 0188:
// batches 6a through 6f were each measured against a clone missing
// every migration since. Their before/after pairs happened to stand,
// because batches touch disjoint tables and 0175's helpers were
// already there — a property of the ordering, not of the instrument,
// and not one to rely on twice.
// `pending` is subtracted, and that is not a loophole.
//
// A batch's own migrations are unlanded by definition — that is what
// a batch IS — and --pending applies them inside every probe
// transaction. Counting them as lag would make the gate refuse the
// exact run it was built to protect, and a gate that blocks the
// normal path gets removed rather than fixed.
//
// What it still catches is the thing it was built for: a migration
// that is neither deployed to the clone nor being applied by this
// run. On 2026-09-13 there were eight of those.
export function cloneLag(opts: {
  cloneHead: string | null;
  localMigrations: readonly string[];
  pending?: readonly string[];
}): { behind: string[]; newest: string | null } {
  const versionOf = (f: string) => f.trim().slice(0, 4);
  const versions = opts.localMigrations
    .map(versionOf)
    .filter((v) => /^\d{4}$/.test(v))
    .sort();
  const applied = new Set((opts.pending ?? []).map(versionOf));
  const newest = versions.length > 0 ? versions[versions.length - 1] : null;
  if (!opts.cloneHead) {
    return { behind: versions.filter((v) => !applied.has(v)), newest };
  }
  return {
    behind: versions.filter(
      (v) => v > (opts.cloneHead as string) && !applied.has(v)
    ),
    newest,
  };
}

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
      -- LIVE, AND DETERMINISTIC. This was an unordered limit-1 with
      -- no deleted_at filter, so it returned whatever the heap handed
      -- back first. Two soft-deleted "Test Company" rows have sat on
      -- the clone since August; the day a bulk UPDATE moved companies
      -- around in the heap, this identity started resolving to one of
      -- them and two unrelated system_admin probes went red with
      -- "0 rows (refused by RLS)" — which is exactly what
      -- companies_hide_deleted does to a ghost, and looks exactly
      -- like a grant that stopped working.
      --
      -- It must also differ from the COMPANY ADMIN's company, not
      -- only the team member's. Adding the ordering without that
      -- clause made this resolve to the company admin's own tenant,
      -- and three cases whose whole claim is "and not in another
      -- company" started proving nothing while going green on the
      -- two probes above. Every isolation claim in this file rests on
      -- these two being different rows.
      --
      -- And not one the fixture GUIDE is assigned to, for the same
      -- reason a third time: the guide probes read this as "a company
      -- outside my caseload". Three consumers, three meanings, one
      -- identity — so it is defined here as "a live company that
      -- belongs to none of our fixtures", which is what all three
      -- actually want.
      (select c.id from public.companies c
        where c.deleted_at is null
          and c.id <> (select company_id from public.profiles
                        where company_id is not null and status='active'
                          and role='team_member' limit 1)
          and c.id <> (select company_id from public.profiles
                        where role='company_admin' and status='active'
                          and company_id is not null limit 1)
          and not exists (
            select 1 from public.guide_assignments ga
            where ga.company_id = c.id
              and ga.guide_id = (select ga2.guide_id
                                   from public.guide_assignments ga2
                                   join public.profiles p2 on p2.id = ga2.guide_id
                                  where p2.role = 'aims_guide'
                                    and p2.status = 'active' limit 1))
        order by c.id limit 1) as other_company`);

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

// The coach's tier-one history tools read the shared organizational
// record through the CALLER'S client, so their visibility is whatever
// RLS already grants that person. They ship no policy of their own
// and widen nothing — which is a claim, and this is the probe.
//
// The claim under test is the one that would matter if it were false:
// an ordinary team member's coach must not be able to read another
// COMPANY'S commitment history. Same-company visibility is existing
// product behaviour, so it is REPORTED rather than asserted — pinning
// a number here would freeze a decision this feature did not make.
//
// The canary is a scratch table carrying both companies' rows behind
// the mistake this would be if somebody wrote the tool as a service-
// role read: a policy that admits any authenticated caller. If that
// side ever stops leaking, the case is broken and its green means
// nothing.
// The about-mode wall, permanent because the batch that would have
// carried it is spent: coach_memories already exists everywhere, so
// its before/after pair has nowhere to stand. This runs against the
// deployed schema on every invocation instead.
//
// Added 2026-09-14 with the amendment that lets a conversation ABOUT
// a team member produce memory. Part 1's policy already guarantees
// the answer, because SELECT is person-only with no role branch and
// the amendment does not touch it. It is probed anyway: "the policy
// already covers it" is the sentence in front of most of
// docs/failure-modes.md, and this is the exact question a person
// reads the help page and then wants checked.
//
// The write goes through record_coach_memory rather than an INSERT,
// because the table is FORCE ROW LEVEL SECURITY with an insert policy
// of profile_id = auth.uid(), so there is no way to plant the row
// from outside a real caller's session. That is the point of it.
// The 'directed' write path, added with 0196.
//
// The claim is not "directed rows can be written" — it is that the
// new kind changes NOTHING about whose store a row lands in. Part 1
// made that structural by giving record_coach_memory no profile_id
// parameter, and a new kind is exactly the kind of change that
// tempts somebody to add one "just for this case". So the probe
// asserts both halves: the definer path writes a directed row to the
// CALLER, and a direct insert naming somebody else is refused.
//
// Skips cleanly before 0196 lands, and runs for real under
// `--pending 0196_coach_memory_directed.sql`.
// The edit path (0197).
//
// Three claims: a caller can rewrite their OWN line; a caller cannot
// rewrite somebody else's, even naming its id directly; and the app's
// role still cannot UPDATE the table at all, so the definer function
// remains the only way in. That last one is E8 held forward through a
// change that could easily have undone it.
async function coachMemoryEdit(
  run: Runner,
  ids: Identities,
  pending: string = ""
): Promise<CaseResult> {
  const [exists] = await run<{ ok: boolean }>(
    [
      "begin;",
      pending,
      `select count(*) > 0 as ok from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'update_coach_memory';`,
      "rollback;",
    ].join("\n")
  );
  if (!exists?.ok) {
    return {
      name: "coach-memory-edit",
      hazard: "A caller edits somebody else's memory",
      wrong: "function not on this schema",
      right: "function not on this schema",
      ok: true,
      detail:
        "not applicable: 0197 has not landed here yet. Runs for real under --pending 0197_coach_memory_edit.sql.",
    };
  }

  const claims = (sub: string) =>
    `set local request.jwt.claims = '{"sub":"${sub}","role":"authenticated"}';`;

  // Own row: rewritten, relabelled `directed`, edited_at stamped, and
  // created_at untouched so the record still says when it first
  // appeared.
  const [own] = await run<{
    content: string;
    kind: string;
    stamped: boolean;
    created_kept: boolean;
  }>(
    [
      "begin;",
      pending,
      "set local role authenticated;",
      claims(ids.member),
      `create temp table _m as select public.record_coach_memory('inferred', 'harness: before edit', null) as id;`,
      `select public.update_coach_memory((select id from _m), 'harness: after edit');`,
      `select m.content, m.kind,
              m.edited_at is not null as stamped,
              m.created_at <= now() as created_kept
         from public.coach_memories m where m.id = (select id from _m);`,
      "rollback;",
    ].join("\n")
  );

  // Somebody else's row, named directly. The function's own
  // profile_id = auth.uid() clause is what refuses it.
  let otherTouched = -1;
  try {
    const [other] = await run<{ n: number }>(
      [
        "begin;",
        pending,
        "set local role authenticated;",
        claims(ids.companyAdmin),
        `create temp table _o as select public.record_coach_memory('said', 'harness: not yours', null) as id;`,
        claims(ids.member),
        `select public.update_coach_memory((select id from _o), 'harness: hijacked');`,
        `select count(*)::int as n from public.coach_memories
          where content = 'harness: hijacked';`,
        "rollback;",
      ].join("\n")
    );
    otherTouched = other?.n ?? -1;
  } catch {
    // The function raises when no row matches the caller, which is
    // the stronger outcome.
    otherTouched = 0;
  }

  const [priv] = await run<{ no_update: boolean }>(
    [
      "begin;",
      pending,
      `select not has_table_privilege('authenticated', 'public.coach_memories', 'update')
         as no_update;`,
      "rollback;",
    ].join("\n")
  );

  const edited = own?.content === "harness: after edit";
  // The kind is PRESERVED, not rewritten. 0197 relabelled an edited
  // row to 'directed'; 0198 reversed that by the product owner's
  // decision, because an edit is a correction rather than a change of
  // authorship. Asserted rather than left alone: silently relabelling
  // somebody's record is the failure this column exists to prevent,
  // in either direction.
  const kindKept = own?.kind === "inferred";
  const ok =
    edited && kindKept && own?.stamped === true && otherTouched === 0 && priv?.no_update === true;
  return {
    name: "coach-memory-edit",
    hazard:
      "A caller edits somebody else's memory, or the app gains a blanket UPDATE on the table",
    wrong: `edit aimed at another profile changed ${otherTouched} row(s)`,
    right: `own row rewritten=${edited}, kind preserved=${kindKept}, edited_at stamped=${own?.stamped}`,
    ok,
    detail: ok
      ? "A person can rewrite their own line and nobody else's, the kind is left as it was, and `authenticated` still holds no UPDATE privilege: the definer function is the only way in."
      : `edited=${edited} kindKept=${kindKept} stamped=${own?.stamped} otherTouched=${otherTouched} (want 0) noUpdatePriv=${priv?.no_update}`,
  };
}

// The boundary the static allowlist check cannot see (0199).
//
// From 0199 a portfolio admin reaches a company's content through
// is_admin_for(), a function that never names the role — so the
// static check passes regardless. This asserts the thing that
// actually matters: WITHOUT an assignment they write nothing, WITH
// one they write only that company, and the assignment they can
// create is only ever their own.
//
// Five claims, because four of them are the ways this could be
// wrong in a direction nobody would notice:
//   1. no assignment -> content write refused (the role's definition)
//   2. assignment    -> content write succeeds (the feature works)
//   3. assignment to A -> content write in B still refused (the
//      assignment is per-company, not a switch)
//   4. cannot insert an assignment naming somebody else (self-only,
//      which is the clause decision 2 rests on)
//   5. home_company_id set, no assignment -> content write STILL
//      refused (0200). This is the one the audit bought. The first
//      design put home into `company_id`, and the audit then found
//      ten policies granting on a bare company match with no role
//      test, three of them writes — so that design would have handed
//      a landing preference the rights of membership. Home lives in
//      its own column now and nothing in the database reads it. This
//      claim is what keeps that true, and it asserts the home was
//      really set first, so a refused UPDATE cannot pass it by
//      leaving the column null.
async function portfolioAssignmentBoundary(
  run: Runner,
  ids: Identities,
  pending: string = ""
): Promise<CaseResult> {
  const [exists] = await run<{ ok: boolean }>(
    [
      "begin;",
      pending,
      `select count(*) > 0 as ok from information_schema.tables
        where table_schema='public' and table_name='portfolio_assignments';`,
      "rollback;",
    ].join("\n")
  );
  if (!exists?.ok) {
    return {
      name: "portfolio-assignment-boundary",
      hazard: "A portfolio admin writes company content without an assignment",
      wrong: "table not on this schema",
      right: "table not on this schema",
      ok: true,
      detail:
        "not applicable: 0199 has not landed here yet. Runs for real under --pending 0199_portfolio_assignments.sql.",
    };
  }

  // A real portfolio_admin, seeded per run: the clone has none of its
  // own, and a fixture that comes back null reports NOT PROVEN rather
  // than passing on an absent caller.
  const PA = "aaaaaaaa-0000-4000-8000-0000000000pa".replace("pa", "ba");
  const seedPa = `
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('${PA}', '00000000-0000-0000-0000-000000000000', 'authenticated',
        'authenticated', 'harness-pa@example.invalid', '', now(), now(), now());
insert into public.profiles (id, company_id, full_name, role, status)
values ('${PA}', null, 'Harness Portfolio Admin', 'portfolio_admin', 'active');`;

  const claims = (sub: string) =>
    `set local request.jwt.claims = '{"sub":"${sub}","role":"authenticated"}';`;
  const A = ids.memberCompany;
  const B = ids.otherCompany;
  const issue = (co: string, title: string) =>
    `insert into public.issues (company_id, title, created_by)
       values ('${co}', '${title}', '${PA}');`;

  const count = async (sql: string): Promise<number> => {
    try {
      const [r] = await run<{ n: number }>(sql);
      return r?.n ?? -1;
    } catch {
      // A statement-level refusal is the stronger outcome and is what
      // an INSERT with no admitting policy actually produces.
      return 0;
    }
  };

  const noAssignment = await count(
    [
      "begin;", pending, seedPa,
      "set local role authenticated;", claims(PA),
      issue(A, "harness: no assignment"),
      `select count(*)::int as n from public.issues where title = 'harness: no assignment';`,
      "rollback;",
    ].join("\n")
  );

  const withAssignment = await count(
    [
      "begin;", pending, seedPa,
      "set local role authenticated;", claims(PA),
      `insert into public.portfolio_assignments (portfolio_admin_id, company_id)
         values ('${PA}', '${A}');`,
      issue(A, "harness: with assignment"),
      `select count(*)::int as n from public.issues where title = 'harness: with assignment';`,
      "rollback;",
    ].join("\n")
  );

  const otherCompany = await count(
    [
      "begin;", pending, seedPa,
      "set local role authenticated;", claims(PA),
      `insert into public.portfolio_assignments (portfolio_admin_id, company_id)
         values ('${PA}', '${A}');`,
      issue(B, "harness: other company"),
      `select count(*)::int as n from public.issues where title = 'harness: other company';`,
      "rollback;",
    ].join("\n")
  );

  const forSomebodyElse = await count(
    [
      "begin;", pending, seedPa,
      "set local role authenticated;", claims(PA),
      `insert into public.portfolio_assignments (portfolio_admin_id, company_id)
         values ('${ids.companyAdmin}', '${A}');`,
      `select count(*)::int as n from public.portfolio_assignments
         where portfolio_admin_id = '${ids.companyAdmin}';`,
      "rollback;",
    ].join("\n")
  );

  // Claim 5 (0200). Guarded on the column, because this case also
  // runs on schemas that predate it and a missing column would error
  // the whole case rather than report on the one claim it belongs to.
  const [hasHome] = await run<{ ok: boolean }>(
    [
      "begin;", pending,
      `select count(*) > 0 as ok from information_schema.columns
        where table_schema='public' and table_name='profiles'
          and column_name='home_company_id';`,
      "rollback;",
    ].join("\n")
  );

  // Set as the portfolio admin themselves, not as the superuser, so
  // the probe covers the shape step 4 will actually ship: a person
  // choosing where they land. profiles_update_self pins role,
  // company_id and status and leaves this column open, which is only
  // safe if choosing a landing place grants nothing — the next probe.
  const homeSet = !hasHome?.ok
    ? 1
    : await count(
        [
          "begin;", pending, seedPa,
          "set local role authenticated;", claims(PA),
          `update public.profiles set home_company_id = '${A}' where id = '${PA}';`,
          `select count(*)::int as n from public.profiles
             where id = '${PA}' and home_company_id = '${A}';`,
          "rollback;",
        ].join("\n")
      );

  const homeWrites = !hasHome?.ok
    ? 0
    : await count(
        [
          "begin;", pending, seedPa,
          "set local role authenticated;", claims(PA),
          `update public.profiles set home_company_id = '${A}' where id = '${PA}';`,
          issue(A, "harness: home without assignment"),
          `select count(*)::int as n from public.issues
             where title = 'harness: home without assignment';`,
          "rollback;",
        ].join("\n")
      );

  const ok =
    noAssignment === 0 &&
    withAssignment === 1 &&
    otherCompany === 0 &&
    forSomebodyElse === 0 &&
    homeSet === 1 &&
    homeWrites === 0;
  return {
    name: "portfolio-assignment-boundary",
    hazard:
      "A portfolio admin writes company content without an assignment, or grants one to somebody else",
    wrong: `without an assignment, content writes landed: ${noAssignment}`,
    right: `with an assignment: ${withAssignment} in that company, ${otherCompany} in another`,
    ok,
    detail: ok
      ? `No assignment, no content write. One assignment, writes in that company and nowhere else. An assignment naming somebody else is refused, which is the clause self-assignment rests on. ${
          hasHome?.ok
            ? "Setting home_company_id grants nothing: the write is still refused."
            : "home_company_id not on this schema; claim 5 skipped (runs under --pending 0200_home_company.sql)."
        }`
      : `no-assignment ${noAssignment} (want 0), with-assignment ${withAssignment} (want 1), other-company ${otherCompany} (want 0), for-somebody-else ${forSomebodyElse} (want 0), home-set ${homeSet} (want 1), home-writes ${homeWrites} (want 0).`,
  };
}

// Decision 7, and the only non-additive step in the portfolio
// sequence (0201). A company admin may end a guide's engagement
// without asking anybody, because a guide may stop working with a
// company that carries on using AiMS HQ.
//
// This is a ROLE WIDENING against 17 live assignment rows, so it gets
// the treatment every widening gets: the delete that must now
// succeed, and the deletes that must still be refused. Three of the
// four claims are refusals, and the third is the one to read twice.
//
//   1. company_admin deletes a guide assignment in their own company
//      -> succeeds (the feature)
//   2. ... in ANOTHER company -> refused (it is their company, not
//      the role, that admits them)
//   3. a team_member of the same company -> refused. The widening is
//      to company_admin, not to "anybody who works here".
//
// A fourth claim used to live here: that a company_admin could NOT
// delete a PORTFOLIO assignment, which was decision 5. Decision 11
// reversed that, and the claim moved rather than flipping in place —
// it belongs to portfolio-assignment-company-access, whose whole
// subject is that table. This case is about guides.
async function guideAssignmentRevocation(
  run: Runner,
  ids: Identities,
  pending: string = ""
): Promise<CaseResult> {
  const claims = (sub: string) =>
    `set local request.jwt.claims = '{"sub":"${sub}","role":"authenticated"}';`;
  const CO = ids.companyAdminCompany;

  // Seeded per run and rolled back. The clone's own 17 rows belong to
  // real guides on real companies, and a probe that deletes one of
  // those to prove it can is a probe that has to be trusted not to
  // leak out of its transaction. This one only ever touches a row it
  // made.
  const seedGuideRow = (company: string) => `
insert into public.guide_assignments (guide_id, company_id)
values ('${ids.guide}', '${company}')
on conflict do nothing;`;

  // THE COUNT RUNS WITH THE ROLE RESET, AND THAT IS NOT A DETAIL.
  //
  // The first version of this case counted as the caller and read 0
  // everywhere, including the three probes whose whole claim is that
  // a row SURVIVED. guide_assignments_select admits the system_admin
  // and the guide themselves, so a company admin counting this table
  // sees nothing whether or not their delete was refused — every
  // claim passed through a read that could only ever answer zero.
  //
  // `reset role` puts the connection back before the count, so what
  // is measured is what is in the table rather than what the caller
  // is allowed to notice. The delete still runs as the caller, which
  // is the only part the policy is being asked about.
  const remaining = async (
    setup: string,
    sub: string,
    del: string,
    where: string
  ): Promise<number> => {
    try {
      const [r] = await run<{ n: number }>(
        [
          "begin;", pending, setup,
          "set local role authenticated;", claims(sub),
          del,
          "reset role;",
          `select count(*)::int as n ${where};`,
          "rollback;",
        ].join("\n")
      );
      return r?.n ?? -1;
    } catch {
      // A statement-level refusal leaves the row in place, which for
      // a DELETE probe is the same answer as "deleted nothing".
      return -2;
    }
  };

  const guideWhere = (company: string) =>
    `from public.guide_assignments
      where guide_id = '${ids.guide}' and company_id = '${company}'`;
  const guideDelete = (company: string) =>
    `delete from public.guide_assignments
      where guide_id = '${ids.guide}' and company_id = '${company}';`;

  // Claim -1, and it is here because failure mode E8 is a policy
  // that is correct and a privilege that was never granted. A DELETE
  // policy cannot admit anybody if `authenticated` holds no DELETE on
  // the table, and the symptom is identical to a policy that refuses:
  // zero rows deleted, no error.
  const [priv] = await run<{ ok: boolean }>(
    [
      "begin;", pending,
      `select has_table_privilege('authenticated', 'public.guide_assignments', 'delete') as ok;`,
      "rollback;",
    ].join("\n")
  );
  const deletePriv = priv?.ok === true;

  // Claim 0. Does the fixture exist at all? Without this the four
  // claims below are unfalsifiable in the direction that matters: a
  // seed that silently inserted nothing reads exactly like a delete
  // that succeeded.
  const seeded = await remaining(
    seedGuideRow(CO),
    ids.companyAdmin,
    "select 1;",
    guideWhere(CO)
  );

  // Claim 0b, and it is load-bearing rather than decorative. A
  // `delete ... where` reads the columns it filters on, so the SELECT
  // policy decides which rows the DELETE policy is ever asked about.
  // The first version of 0201 widened only the delete and changed
  // nothing: the row was invisible to the company admin, so there was
  // nothing for the new policy to admit. Asserting the visibility
  // here means a future narrowing of guide_assignments_select breaks
  // this claim loudly, instead of silently disarming the revocation
  // below it.
  //
  // Counted AS THE CALLER, deliberately: this is the one claim in the
  // case that asks what the company admin can see rather than what is
  // in the table.
  const visible = await (async () => {
    try {
      const [r] = await run<{ n: number }>(
        [
          "begin;", pending, seedGuideRow(CO),
          "set local role authenticated;", claims(ids.companyAdmin),
          `select count(*)::int as n ${guideWhere(CO)};`,
          "rollback;",
        ].join("\n")
      );
      return r?.n ?? -1;
    } catch {
      return -2;
    }
  })();

  const ownCompany = await remaining(
    seedGuideRow(CO),
    ids.companyAdmin,
    guideDelete(CO),
    guideWhere(CO)
  );

  const otherCompany = await remaining(
    seedGuideRow(ids.otherCompany),
    ids.companyAdmin,
    guideDelete(ids.otherCompany),
    guideWhere(ids.otherCompany)
  );

  const asMember = await remaining(
    seedGuideRow(ids.memberCompany),
    ids.member,
    guideDelete(ids.memberCompany),
    guideWhere(ids.memberCompany)
  );

  const ok =
    deletePriv &&
    seeded === 1 &&
    visible === 1 &&
    ownCompany === 0 &&
    otherCompany === 1 &&
    asMember === 1;

  return {
    name: "guide-assignment-revocation",
    hazard:
      "A company cannot end a guide's engagement, or can end things that are not theirs to end",
    wrong: `rows left after the company admin's own-company delete: ${ownCompany} (want 0)`,
    right: `fixture seeded (${seeded}) and visible to the company admin (${visible}), own company removed, other company kept (${otherCompany}), member refused (${asMember})`,
    ok,
    detail: ok
      ? "A company admin sees the assignment and ends it, in their own company and nowhere else. A team member of the same company is refused. Whether they may end a PORTFOLIO admin's assignment is decision 11's question and portfolio-assignment-company-access's claim."
      : `authenticated holds DELETE on guide_assignments: ${deletePriv} (want true), seeded ${seeded} (want 1), visible-to-company-admin ${visible} (want 1; a delete cannot reach a row the SELECT policy hides), own-company ${ownCompany} (want 0), other-company ${otherCompany} (want 1), as-member ${asMember} (want 1).`,
  };
}

// The card's read (0201). assigned_access() is SECURITY DEFINER, so
// it sees guide_assignments, portfolio_assignments and profiles
// regardless of who calls it — which makes its own guard the entire
// boundary, and makes it worth probing as three different callers
// rather than trusting the `if` at the top of the function.
//
// It returns EMPTY rather than raising for a caller it does not
// admit, so every claim here is a row count.
async function assignedAccessRead(
  run: Runner,
  ids: Identities,
  pending: string = ""
): Promise<CaseResult> {
  const [exists] = await run<{ ok: boolean }>(
    [
      "begin;", pending,
      `select count(*) > 0 as ok from pg_proc
        where proname = 'assigned_access'
          and pronamespace = 'public'::regnamespace;`,
      "rollback;",
    ].join("\n")
  );
  if (!exists?.ok) {
    return {
      name: "assigned-access-read",
      hazard: "The assigned-access card names people to callers who may not ask",
      wrong: "function not on this schema",
      right: "function not on this schema",
      ok: true,
      detail:
        "not applicable: 0201 has not landed here yet. Runs for real under --pending 0201_assigned_access.sql.",
    };
  }

  const claims = (sub: string) =>
    `set local request.jwt.claims = '{"sub":"${sub}","role":"authenticated"}';`;
  const CO = ids.companyAdminCompany;
  const seed = `
insert into public.guide_assignments (guide_id, company_id)
values ('${ids.guide}', '${CO}')
on conflict do nothing;`;

  const count = async (sub: string, company: string): Promise<number> => {
    try {
      const [r] = await run<{ n: number }>(
        [
          "begin;", pending, seed,
          "set local role authenticated;", claims(sub),
          `select count(*)::int as n from public.assigned_access('${company}');`,
          "rollback;",
        ].join("\n")
      );
      return r?.n ?? -1;
    } catch {
      return -2;
    }
  };

  const asCompanyAdmin = await count(ids.companyAdmin, CO);
  const asMember = await count(ids.member, CO);
  const asOtherCompanyAdmin = await count(ids.companyAdmin, ids.otherCompany);
  const asGuide = await count(ids.guide, CO);

  const ok =
    asCompanyAdmin >= 1 &&
    asMember === 0 &&
    asOtherCompanyAdmin === 0 &&
    asGuide === 0;

  return {
    name: "assigned-access-read",
    hazard: "The assigned-access card names people to callers who may not ask",
    wrong: `an ordinary member read the list: ${asMember} row(s)`,
    right: `company admin sees ${asCompanyAdmin}; member ${asMember}, other company's admin ${asOtherCompanyAdmin}, assigned guide ${asGuide}`,
    ok,
    detail: ok
      ? "The company's own admin sees who is assigned. An ordinary member of that company sees nothing, another company's admin sees nothing, and the assigned guide sees nothing — decision 9 keeps the card off the guide's copy of this page."
      : `company-admin ${asCompanyAdmin} (want >=1), member ${asMember} (want 0), other-company admin ${asOtherCompanyAdmin} (want 0), guide ${asGuide} (want 0).`,
  };
}

// Who may order the portfolio (0203).
//
// The column lives on `companies`, which four roles can already write
// in different ways, so the interesting claims are all about who is
// refused. The guard is an allowlist for portfolio_admin and a
// denylist-by-construction for company_admin and aims_guide, which
// means those two are refused the new column by a guard written
// before it existed — a claim worth asserting precisely because
// nothing in 0203 had to be written to make it true.
//
// Five claims:
//   1. system_admin sets sort_order
//   2. portfolio_admin sets sort_order (the point of the feature)
//   3. company_admin is refused it on their own company
//   4. aims_guide is refused it on a company they are assigned to
//   5. portfolio_admin is STILL refused deleted_at, so widening the
//      allowlist by one word did not widen it by two
async function companySortOrder(
  run: Runner,
  ids: Identities,
  pending: string = ""
): Promise<CaseResult> {
  const [exists] = await run<{ ok: boolean }>(
    [
      "begin;", pending,
      `select count(*) > 0 as ok from information_schema.columns
        where table_schema='public' and table_name='companies'
          and column_name='sort_order';`,
      "rollback;",
    ].join("\n")
  );
  if (!exists?.ok) {
    return {
      name: "company-sort-order",
      hazard: "A company reorders the portfolio it sits in",
      wrong: "column not on this schema",
      right: "column not on this schema",
      ok: true,
      detail:
        "not applicable: 0203 has not landed here yet. Runs for real under --pending 0203_company_sort_order.sql.",
    };
  }

  const claims = (sub: string) =>
    `set local request.jwt.claims = '{"sub":"${sub}","role":"authenticated"}';`;

  // A real portfolio_admin, seeded per run: the clone has none.
  const PA = "aaaaaaaa-0000-4000-8000-0000000000so".replace("so", "50");
  const seedPa = `
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('${PA}', '00000000-0000-0000-0000-000000000000', 'authenticated',
        'authenticated', 'harness-sort@example.invalid', '', now(), now(), now());
insert into public.profiles (id, company_id, full_name, role, status)
values ('${PA}', null, 'Harness Sorter', 'portfolio_admin', 'active');`;

  // Counted with the role reset: the question is what is in the row,
  // not what the caller can read back afterwards.
  const wrote = async (
    setup: string,
    sub: string,
    company: string,
    setClause: string
  ): Promise<number> => {
    try {
      const [r] = await run<{ n: number }>(
        [
          "begin;", pending, setup,
          "set local role authenticated;", claims(sub),
          `update public.companies set ${setClause} where id = '${company}';`,
          "reset role;",
          `select count(*)::int as n from public.companies
            where id = '${company}' and sort_order = 42;`,
          "rollback;",
        ].join("\n")
      );
      return r?.n ?? -1;
    } catch {
      // The guard raises insufficient_privilege, which aborts the
      // transaction. That is the refusal.
      return 0;
    }
  };

  const bySysadmin = await wrote("", ids.systemAdmin, ids.memberCompany, "sort_order = 42");
  const byPortfolio = await wrote(seedPa, PA, ids.memberCompany, "sort_order = 42");
  const byCompanyAdmin = await wrote("", ids.companyAdmin, ids.companyAdminCompany, "sort_order = 42");
  const byGuide = await wrote("", ids.guide, ids.guideCompany, "sort_order = 42");

  // Claim 5: the allowlist gained one word, not two.
  let deletedAtStillRefused = false;
  try {
    await run(
      [
        "begin;", pending, seedPa,
        "set local role authenticated;", claims(PA),
        `update public.companies set deleted_at = now() where id = '${ids.memberCompany}';`,
        "rollback;",
      ].join("\n")
    );
  } catch {
    deletedAtStillRefused = true;
  }

  const ok =
    bySysadmin === 1 &&
    byPortfolio === 1 &&
    byCompanyAdmin === 0 &&
    byGuide === 0 &&
    deletedAtStillRefused;

  return {
    name: "company-sort-order",
    hazard: "A company reorders the portfolio it sits in",
    wrong: `company_admin wrote sort_order: ${byCompanyAdmin === 1 ? "YES" : "no"}`,
    right: `system_admin ${bySysadmin}, portfolio_admin ${byPortfolio}, company_admin ${byCompanyAdmin}, guide ${byGuide}`,
    ok,
    detail: ok
      ? "The two container roles order the portfolio. A company admin and a guide are refused, by a denylist-by-construction written before the column existed — 0203 had to say nothing to make that true. Widening the portfolio allowlist by one word did not widen it by two: deleted_at is still refused."
      : `system_admin ${bySysadmin} (want 1), portfolio_admin ${byPortfolio} (want 1), company_admin ${byCompanyAdmin} (want 0), guide ${byGuide} (want 0), deleted_at-still-refused ${deletedAtStillRefused} (want true).`,
  };
}

// Who a company may read (0204).
//
// The widening is scoped to ASSIGNMENTS, not to platform roles, and
// every claim here is about that distinction. The risk of getting it
// wrong is a company enumerating the instance's staff, so the
// refusals outnumber the grants.
//
// EVERY IDENTITY IS SEEDED, and that is a correction. The first
// version fished its control out of the clone — "an unassigned
// system_admin" — and the system_admin it found held a guide
// assignment, because system admins can. The policy was right and
// the control was not, which is the more embarrassing way to get a
// red. A fixture the case builds itself cannot drift underneath it.
//
// Five claims:
//   1. a company_admin reads a guide assigned to their company
//   2. ... and a portfolio admin assigned to it
//   3. an ordinary MEMBER reads them too, because the owner picker
//      renders for everyone and a list that changed by viewer would
//      be worse than no list
//   4. an OUTSIDER — company-less, no assignment anywhere — stays
//      invisible. This is the claim that separates "assigned to my
//      company" from "company-less", and it is the whole boundary.
//   5. the read brought no write with it
async function profilesSelectAssigned(
  run: Runner,
  ids: Identities,
  pending: string = ""
): Promise<CaseResult> {
  const [exists] = await run<{ ok: boolean }>(
    [
      "begin;", pending,
      `select count(*) > 0 as ok from pg_policies
        where schemaname='public' and tablename='profiles'
          and policyname='profiles_select_assigned';`,
      "rollback;",
    ].join("\n")
  );
  if (!exists?.ok) {
    return {
      name: "profiles-select-assigned",
      hazard: "A company enumerates the instance's staff",
      wrong: "policy not on this schema",
      right: "policy not on this schema",
      ok: true,
      detail:
        "not applicable: 0204 has not landed here yet. Runs for real under --pending 0204_profiles_select_assigned.sql.",
    };
  }

  const claims = (sub: string) =>
    `set local request.jwt.claims = '{"sub":"${sub}","role":"authenticated"}';`;
  const CO = ids.companyAdminCompany;
  const uid = (tag: string) => `aaaa0204-0000-4000-8000-0000000000${tag}`;
  const GUIDE = uid("01");
  const PA = uid("02");
  const OUTSIDER = uid("03");
  const MEMBER = uid("04");

  const person = (id: string, name: string, role: string, company: string | null) => `
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('${id}', '00000000-0000-0000-0000-000000000000', 'authenticated',
        'authenticated', '${id}@example.invalid', '', now(), now(), now());
insert into public.profiles (id, company_id, full_name, role, status)
values ('${id}', ${company ? `'${company}'` : "null"}, '${name}', '${role}', 'active');`;

  const seed = [
    person(GUIDE, "Harness Assigned Guide", "aims_guide", null),
    person(PA, "Harness Assigned PA", "portfolio_admin", null),
    person(OUTSIDER, "Harness Outsider", "aims_guide", null),
    person(MEMBER, "Harness Member", "team_member", CO),
    `insert into public.guide_assignments (guide_id, company_id)
       values ('${GUIDE}', '${CO}') on conflict do nothing;`,
    `insert into public.portfolio_assignments (portfolio_admin_id, company_id)
       values ('${PA}', '${CO}') on conflict do nothing;`,
  ].join("\n");

  const visible = async (sub: string, targetId: string): Promise<number> => {
    try {
      const [r] = await run<{ n: number }>(
        [
          "begin;", pending, seed,
          "set local role authenticated;", claims(sub),
          `select count(*)::int as n from public.profiles where id = '${targetId}';`,
          "rollback;",
        ].join("\n")
      );
      return r?.n ?? -1;
    } catch {
      return -2;
    }
  };

  const guideToAdmin = await visible(ids.companyAdmin, GUIDE);
  const portfolioToAdmin = await visible(ids.companyAdmin, PA);
  const guideToMember = await visible(MEMBER, GUIDE);
  const outsiderToAdmin = await visible(ids.companyAdmin, OUTSIDER);

  // The read is a read. Measured with the role reset, because the
  // question is what is in the row and not what the caller can see.
  const [renamed] = await run<{ n: number }>(
    [
      "begin;", pending, seed,
      "set local role authenticated;", claims(ids.companyAdmin),
      `update public.profiles set full_name = 'harness rename' where id = '${GUIDE}';`,
      "reset role;",
      `select count(*)::int as n from public.profiles
        where id = '${GUIDE}' and full_name = 'harness rename';`,
      "rollback;",
    ].join("\n")
  ).catch(() => [{ n: 0 }]);
  const writeRefused = (renamed?.n ?? -1) === 0;

  const ok =
    guideToAdmin === 1 &&
    portfolioToAdmin === 1 &&
    guideToMember === 1 &&
    outsiderToAdmin === 0 &&
    writeRefused;

  return {
    name: "profiles-select-assigned",
    hazard: "A company enumerates the instance's staff",
    wrong: `a company-less profile with no assignment, readable: ${outsiderToAdmin === 1 ? "YES" : "no"}`,
    right: `assigned guide ${guideToAdmin}, assigned portfolio admin ${portfolioToAdmin}, seen by a member ${guideToMember}, unassigned outsider ${outsiderToAdmin}`,
    ok,
    detail: ok
      ? "A company reads the people assigned to it, admins and members alike, and nobody else. A company-less profile holding no assignment stays invisible, which is what keeps this an assignment grant rather than a licence to enumerate the instance. The read brought no write with it."
      : `assigned-guide ${guideToAdmin} (want 1), assigned-portfolio ${portfolioToAdmin} (want 1), to-member ${guideToMember} (want 1), unassigned-outsider ${outsiderToAdmin} (want 0), write-refused ${writeRefused} (want true).`,
  };
}

// A company sees and ends a portfolio admin's assignment (0205).
//
// This reverses decision 5, so the case that used to assert the
// refusal now asserts the grant — and the claims that matter are the
// ones drawing the NEW line, not the old one. A company may end the
// arrangement; it may not reach the person, and neither may anybody
// below a company admin.
//
// Six claims:
//   1. a company_admin sees the assignment naming their company
//   2. a MEMBER sees it too (roster and picker render for everyone)
//   3. a company_admin ENDS it
//   4. a company_admin of ANOTHER company cannot
//   5. a team member of the same company cannot
//   6. the profile survives: ending an assignment removes a row from
//      portfolio_assignments and nothing from profiles
async function portfolioAssignmentCompanyAccess(
  run: Runner,
  ids: Identities,
  pending: string = ""
): Promise<CaseResult> {
  const [widened] = await run<{ ok: boolean }>(
    [
      "begin;", pending,
      `select count(*) > 0 as ok from pg_policies
        where schemaname='public' and tablename='portfolio_assignments'
          and policyname='portfolio_assignments_delete'
          and qual like '%company_admin%';`,
      "rollback;",
    ].join("\n")
  );
  if (!widened?.ok) {
    return {
      name: "portfolio-assignment-company-access",
      hazard: "A company reaches the person instead of the arrangement",
      wrong: "policy not widened on this schema",
      right: "policy not widened on this schema",
      ok: true,
      detail:
        "not applicable: 0205 has not landed here yet. Runs for real under --pending 0205_portfolio_assignment_company_access.sql.",
    };
  }

  const claims = (sub: string) =>
    `set local request.jwt.claims = '{"sub":"${sub}","role":"authenticated"}';`;
  const CO = ids.companyAdminCompany;
  const uid = (tag: string) => `aaaa0205-0000-4000-8000-0000000000${tag}`;
  const PA = uid("01");
  const MEMBER = uid("02");

  const seed = `
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('${PA}', '00000000-0000-0000-0000-000000000000', 'authenticated',
        'authenticated', '${PA}@example.invalid', '', now(), now(), now()),
       ('${MEMBER}', '00000000-0000-0000-0000-000000000000', 'authenticated',
        'authenticated', '${MEMBER}@example.invalid', '', now(), now(), now());
insert into public.profiles (id, company_id, full_name, role, status)
values ('${PA}', null, 'Harness PA 0205', 'portfolio_admin', 'active'),
       ('${MEMBER}', '${CO}', 'Harness Member 0205', 'team_member', 'active');
insert into public.portfolio_assignments (portfolio_admin_id, company_id)
values ('${PA}', '${CO}') on conflict do nothing;`;

  // Seen, as the caller.
  const seenBy = async (sub: string): Promise<number> => {
    try {
      const [r] = await run<{ n: number }>(
        [
          "begin;", pending, seed,
          "set local role authenticated;", claims(sub),
          `select count(*)::int as n from public.portfolio_assignments
            where portfolio_admin_id = '${PA}' and company_id = '${CO}';`,
          "rollback;",
        ].join("\n")
      );
      return r?.n ?? -1;
    } catch {
      return -2;
    }
  };

  // Remaining, measured with the role RESET — E11's other half. A
  // caller who cannot see the row would report zero either way.
  const remainingAfterDeleteBy = async (
    sub: string,
    company: string
  ): Promise<number> => {
    try {
      const [r] = await run<{ n: number }>(
        [
          "begin;", pending, seed,
          "set local role authenticated;", claims(sub),
          `delete from public.portfolio_assignments
            where portfolio_admin_id = '${PA}' and company_id = '${company}';`,
          "reset role;",
          `select count(*)::int as n from public.portfolio_assignments
            where portfolio_admin_id = '${PA}' and company_id = '${CO}';`,
          "rollback;",
        ].join("\n")
      );
      return r?.n ?? -1;
    } catch {
      return -2;
    }
  };

  const seenByAdmin = await seenBy(ids.companyAdmin);
  const seenByMember = await seenBy(MEMBER);
  const byAdmin = await remainingAfterDeleteBy(ids.companyAdmin, CO);
  const byOtherAdmin = await (async () => {
    const [other] = await run<{ id: string | null }>(
      [
        "begin;", pending,
        `select id from public.profiles
          where role='company_admin' and status='active'
            and company_id is not null and company_id <> '${CO}' limit 1;`,
        "rollback;",
      ].join("\n")
    );
    if (!other?.id) return 1; // nobody to probe with; treat as kept
    return remainingAfterDeleteBy(other.id, CO);
  })();
  const byMember = await remainingAfterDeleteBy(MEMBER, CO);

  // The person outlives the arrangement.
  const [survived] = await run<{ n: number }>(
    [
      "begin;", pending, seed,
      "set local role authenticated;", claims(ids.companyAdmin),
      `delete from public.portfolio_assignments
        where portfolio_admin_id = '${PA}' and company_id = '${CO}';`,
      "reset role;",
      `select count(*)::int as n from public.profiles where id = '${PA}';`,
      "rollback;",
    ].join("\n")
  );

  const ok =
    seenByAdmin === 1 &&
    seenByMember === 1 &&
    byAdmin === 0 &&
    byOtherAdmin === 1 &&
    byMember === 1 &&
    (survived?.n ?? -1) === 1;

  return {
    name: "portfolio-assignment-company-access",
    hazard: "A company reaches the person instead of the arrangement",
    wrong: `after the company admin ends it, the profile is gone: ${(survived?.n ?? -1) === 1 ? "no" : "YES"}`,
    right: `seen by admin ${seenByAdmin} and member ${seenByMember}; ended by its own company ${byAdmin === 0}, refused to another company's admin and to a member; profile still there ${survived?.n}`,
    ok,
    detail: ok
      ? "A company sees the assignment naming it, admins and members alike, and its admin can end it. Another company's admin cannot, and neither can a team member. Ending it removes a row from portfolio_assignments and leaves the person on the instance, which is the whole difference between this and the roster's Delete."
      : `seen-by-admin ${seenByAdmin} (want 1), seen-by-member ${seenByMember} (want 1), ended-by-own-admin ${byAdmin} (want 0), other-company-admin ${byOtherAdmin} (want 1), member ${byMember} (want 1), profile-survives ${survived?.n} (want 1).`,
  };
}

// 0207 against rows that look like the ones it names.
//
// THE PROBLEM THIS SOLVES. 0207 promotes two people by hardcoded
// uuid on one instance. Neither exists on the dev clone, so
// `migrate:dev` runs it as a clean no-op — which proves the SQL
// parses and that it refuses to act on a database where the profiles
// are absent, and proves nothing at all about what it does when they
// are present. The migration self-verifies, but only where it finds
// them, which is the one database nobody wants to learn on.
//
// So the fixtures are built here, with the same ids and names the
// migration looks for, and the migration is applied on top of them
// inside a transaction that rolls back. What runs is the real file.
//
// Five claims:
//   1. both are promoted: role, company_id null, home set
//   2. both get an assignment for Promise One
//   3. THEIR COMMITMENTS SURVIVE, same count, still owned by them.
//      The whole reason they get an assignment at all.
//   4. it is idempotent: applied twice, still one assignment each
//   5. it REFUSES a profile that is not who it expects, and takes
//      the transaction with it rather than promoting a stranger
async function promoteStevenAndSean(
  run: Runner,
  _ids: Identities,
  pending: string = ""
): Promise<CaseResult> {
  if (!pending.includes("0207")) {
    return {
      name: "promote-steve-and-sean",
      hazard: "A one-off promotion lands on the wrong person, or detaches them from their work",
      wrong: "0207 not among the pending migrations",
      right: "0207 not among the pending migrations",
      ok: true,
      detail:
        "not applicable: runs only under --pending 0207_promote_steve_and_sean.sql, which is the file it exercises.",
    };
  }

  const STEVE = "96cba0fc-9f08-4732-9a07-09ad880763e0";
  const SEAN = "52e077c5-6ee4-4cca-b4a4-a39b5bd6bfc5";
  const PROMISE_ONE = "54bac6cf-aabb-4e7a-a083-eda16a8e5460";

  // Same ids, same names, same company as the migration names. A
  // fixture that differs anywhere the migration checks would prove
  // the guard fires rather than the promotion works.
  const seed = `
insert into public.companies (id, name, timezone, status)
values ('${PROMISE_ONE}', '1 - Promise One', 'America/New_York', 'active')
on conflict (id) do nothing;
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('${STEVE}', '00000000-0000-0000-0000-000000000000', 'authenticated',
        'authenticated', 'harness-steve@example.invalid', '', now(), now(), now()),
       ('${SEAN}', '00000000-0000-0000-0000-000000000000', 'authenticated',
        'authenticated', 'harness-sean@example.invalid', '', now(), now(), now())
on conflict (id) do nothing;
insert into public.profiles (id, company_id, full_name, role, status)
values ('${STEVE}', '${PROMISE_ONE}', 'Steve Kessen', 'team_member', 'active'),
       ('${SEAN}', '${PROMISE_ONE}', 'Sean Wenger', 'team_member', 'active')
on conflict (id) do nothing;
insert into public.commitments (company_id, owner_id, description, week_ending, due_date, status)
select '${PROMISE_ONE}', '${STEVE}', 'harness steve ' || g, current_date, current_date, 'open'
  from generate_series(1, 4) g;
insert into public.commitments (company_id, owner_id, description, week_ending, due_date, status)
select '${PROMISE_ONE}', '${SEAN}', 'harness sean ' || g, current_date, current_date, 'open'
  from generate_series(1, 6) g;`;

  const measure = async (extra: string) => {
    const [r] = await run<{
      steve_role: string;
      steve_company: string | null;
      steve_home: string | null;
      sean_role: string;
      assignments: number;
      steve_open: number;
      sean_open: number;
    }>(
      [
        "begin;", seed, pending, extra,
        `select
           (select role from public.profiles where id = '${STEVE}') as steve_role,
           (select company_id::text from public.profiles where id = '${STEVE}') as steve_company,
           (select home_company_id::text from public.profiles where id = '${STEVE}') as steve_home,
           (select role from public.profiles where id = '${SEAN}') as sean_role,
           (select count(*)::int from public.portfolio_assignments
             where portfolio_admin_id in ('${STEVE}', '${SEAN}')
               and company_id = '${PROMISE_ONE}') as assignments,
           (select count(*)::int from public.commitments
             where owner_id = '${STEVE}' and status = 'open' and deleted_at is null) as steve_open,
           (select count(*)::int from public.commitments
             where owner_id = '${SEAN}' and status = 'open' and deleted_at is null) as sean_open;`,
        "rollback;",
      ].join("\n")
    );
    return r;
  };

  const after = await measure("");
  // Applied twice: the migration returns early on an existing
  // portfolio_admin, so nothing should double.
  const twice = await measure(pending);

  // The guard. A profile with the right id and the wrong name must
  // stop the migration rather than promote whoever is there.
  let refusedImpostor = false;
  try {
    await run(
      [
        "begin;", seed,
        `update public.profiles set full_name = 'Somebody Else' where id = '${STEVE}';`,
        pending,
        "rollback;",
      ].join("\n")
    );
  } catch {
    refusedImpostor = true;
  }

  const promoted =
    after?.steve_role === "portfolio_admin" &&
    after?.sean_role === "portfolio_admin" &&
    after?.steve_company === null &&
    after?.steve_home === PROMISE_ONE;
  const kept = after?.steve_open === 4 && after?.sean_open === 6;
  const idempotent = twice?.assignments === 2 && twice?.steve_open === 4;

  const ok =
    promoted && kept && after?.assignments === 2 && idempotent && refusedImpostor;

  return {
    name: "promote-steve-and-sean",
    hazard:
      "A one-off promotion lands on the wrong person, or detaches them from their work",
    wrong: `a profile with the right id and the wrong name: ${refusedImpostor ? "refused" : "PROMOTED"}`,
    right: `both promoted, ${after?.assignments} assignments, commitments kept (${after?.steve_open} + ${after?.sean_open})`,
    ok,
    detail: ok
      ? "Run against fixtures carrying the ids, names and company the migration names: both are promoted, company_id empties, home fills in, each gets an assignment for Promise One, and all ten open commitments are still owned by the people who own them today. Applying it twice changes nothing. A profile with the right id and the wrong name stops the whole transaction."
      : `promoted ${promoted}, commitments-kept ${kept} (steve ${after?.steve_open} want 4, sean ${after?.sean_open} want 6), assignments ${after?.assignments} (want 2), idempotent ${idempotent}, impostor-refused ${refusedImpostor}.`,
  };
}

async function coachMemoryDirected(
  run: Runner,
  ids: Identities,
  pending: string = ""
): Promise<CaseResult> {
  const MARK = "harness fixture: directed row";
  const [allowed] = await run<{ ok: boolean }>(
    [
      "begin;",
      pending,
      `select pg_get_constraintdef(oid) like '%directed%' as ok
         from pg_constraint
        where conrelid = 'public.coach_memories'::regclass
          and conname = 'coach_memories_kind_check';`,
      "rollback;",
    ].join("\n")
  );
  if (!allowed?.ok) {
    return {
      name: "coach-memory-directed",
      hazard: "A directed memory lands in somebody else's store",
      wrong: "kind not on this schema",
      right: "kind not on this schema",
      ok: true,
      detail:
        "not applicable: 0196 has not landed here yet. Runs for real under --pending 0196_coach_memory_directed.sql.",
    };
  }

  const claims = (sub: string) =>
    `set local request.jwt.claims = '{"sub":"${sub}","role":"authenticated"}';`;

  // Written through the definer path as the member, then checked:
  // whose row is it?
  const [mine] = await run<{ own: number; theirs: number }>(
    [
      "begin;",
      pending,
      "set local role authenticated;",
      claims(ids.member),
      `select public.record_coach_memory('directed', '${MARK}', null);`,
      `select
         (select count(*)::int from public.coach_memories
           where content = '${MARK}' and profile_id = '${ids.member}') as own,
         (select count(*)::int from public.coach_memories
           where content = '${MARK}' and profile_id <> '${ids.member}') as theirs;`,
      "rollback;",
    ].join("\n")
  );

  // And the thing somebody would reach for if they wanted to direct a
  // memory into another person's store: a direct insert naming them.
  // The insert policy is profile_id = auth.uid(), so this is refused.
  let plantedRows = -1;
  try {
    const [planted] = await run<{ n: number }>(
      [
        "begin;",
        pending,
        "set local role authenticated;",
        claims(ids.member),
        `insert into public.coach_memories (profile_id, kind, content)
           values ('${ids.companyAdmin}', 'directed', '${MARK} planted');`,
        `select count(*)::int as n from public.coach_memories
           where content = '${MARK} planted';`,
        "rollback;",
      ].join("\n")
    );
    plantedRows = planted?.n ?? -1;
  } catch {
    // A refusal that raises rather than returning 0 is the stronger
    // outcome and is what the insert policy actually does.
    plantedRows = 0;
  }

  const ok = mine?.own === 1 && mine?.theirs === 0 && plantedRows === 0;
  return {
    name: "coach-memory-directed",
    hazard:
      "A directed memory lands in somebody else's store, or can be aimed at one",
    wrong: `direct insert naming another profile left ${plantedRows} row(s)`,
    right: `definer path wrote ${mine?.own ?? "?"} row to the caller and ${mine?.theirs ?? "?"} to anyone else`,
    ok,
    detail: ok
      ? "A directed row goes to the caller and nowhere else, and an insert aimed at another profile is refused. The new kind did not widen the write path."
      : `own ${mine?.own} (want 1), theirs ${mine?.theirs} (want 0), planted ${plantedRows} (want 0).`,
  };
}

async function coachMemoryAboutMode(
  run: Runner,
  _ids: Identities
): Promise<CaseResult> {
  const CONVO = "aaaaaaaa-0000-4000-8000-00000000000a";
  const MARK = "harness fixture: about-mode leader commitment";

  // A leader and a team member in the SAME company, so the about-mode
  // insert policy on coaching_conversations is actually satisfiable.
  const [pair] = await run<{ leader: string | null; subject: string | null; company: string | null }>(
    `select a.id as leader, m.id as subject, a.company_id as company
       from public.profiles a
       join public.profiles m
         on m.company_id = a.company_id and m.id <> a.id
        and m.role = 'team_member' and m.status = 'active'
      where a.role = 'company_admin' and a.status = 'active'
        and a.company_id is not null
      limit 1;`
  );
  if (!pair?.leader || !pair?.subject) {
    return {
      name: "coach-memory-about-mode",
      hazard: "A leader's memory from a conversation about someone becomes readable by that someone",
      wrong: "no fixture",
      right: "no fixture",
      ok: false,
      detail: "NOT PROVEN: no company_admin and team_member pair in one company on this database.",
    };
  }

  const claims = (sub: string) =>
    `set local request.jwt.claims = '{"sub":"${sub}","role":"authenticated"}';`;
  // Written by the leader, through the only path that can write it.
  const write = `
insert into public.coaching_conversations
  (id, company_id, subject_profile_id, created_by, title, mode)
values ('${CONVO}', '${pair.company}', '${pair.subject}', '${pair.leader}',
        'harness fixture: about-mode', 'about');
select public.record_coach_memory('said', '${MARK}', '${CONVO}');`;

  // A canary the subject CAN read, so a zero below is a refusal and
  // not a session that reads nothing at all.
  const canary = `
create table _rls_mem_canary (id int primary key);
insert into _rls_mem_canary values (1);
alter table _rls_mem_canary enable row level security;
create policy p on _rls_mem_canary for select to authenticated using (true);
grant select on _rls_mem_canary to authenticated;`;

  const [asSubject] = await run<{ seen: number; canary: number }>(
    [
      "begin;",
      canary,
      "set local role authenticated;",
      claims(pair.leader),
      write,
      claims(pair.subject),
      `select (select count(*) from public.coach_memories
                where conversation_ref = '${CONVO}')::int as seen,
              (select count(*) from _rls_mem_canary)::int as canary;`,
      "rollback;",
    ].join("\n")
  );

  const [asLeader] = await run<{ seen: number }>(
    [
      "begin;",
      "set local role authenticated;",
      claims(pair.leader),
      write,
      `select (select count(*) from public.coach_memories
                where conversation_ref = '${CONVO}')::int as seen;`,
      "rollback;",
    ].join("\n")
  );

  const subjectSees = asSubject?.seen ?? -1;
  const leaderSees = asLeader?.seen ?? -1;
  const canarySees = asSubject?.canary ?? -1;
  const ok = subjectSees === 0 && leaderSees === 1 && canarySees === 1;
  return {
    name: "coach-memory-about-mode",
    hazard:
      "A leader's memory from a conversation about a team member becomes readable by that team member",
    wrong: `admit-all canary returned ${canarySees} row to the subject's session`,
    right: `subject sees ${subjectSees} of the leader's rows for that conversation`,
    ok,
    detail: ok
      ? `The team member reads none of it, while the leader reads ${leaderSees}. The row was written by record_coach_memory as the leader, so it is a real memory refused by the policy, not an absent one.`
      : `subject ${subjectSees} (want 0), leader ${leaderSees} (want 1), canary ${canarySees} (want 1).`,
  };
}

async function coachHistoryReads(
  run: Runner,
  ids: Identities
): Promise<CaseResult> {
  const sql = asCaller(
    ids.member,
    `
create table _rls_wrong (id int primary key, company_id uuid);
insert into _rls_wrong values (1, '${ids.memberCompany}'), (2, '${ids.otherCompany}');
alter table _rls_wrong enable row level security;
create policy p on _rls_wrong for select to authenticated using (true);
grant select on _rls_wrong to authenticated;`,
    `select
       (select count(*) from _rls_wrong where company_id = '${ids.otherCompany}')::int as wrong,
       (select count(*) from public.commitments
          where company_id = '${ids.otherCompany}')::int as right_,
       (select count(*) from public.commitments
          where company_id = '${ids.memberCompany}')::int as own,
       (select count(*) from public.issues
          where company_id = '${ids.otherCompany}')::int as issues_other,
       (select count(*) from public.company_discipline_snapshots
          where company_id = '${ids.otherCompany}')::int as snapshots_other;`
  );
  const [row] = await run<{
    wrong: number;
    right_: number;
    own: number;
    issues_other: number;
    snapshots_other: number;
  }>(sql);
  const leaked =
    (row?.right_ ?? 0) + (row?.issues_other ?? 0) + (row?.snapshots_other ?? 0);
  return {
    name: "coach-history-reads",
    hazard:
      "A history tool reading as service role would return every company's record to every caller",
    wrong: `admit-all policy returned ${row?.wrong ?? "?"} of the other company's rows`,
    right: `commitments ${row?.right_ ?? "?"}, issues ${row?.issues_other ?? "?"}, snapshots ${row?.snapshots_other ?? "?"} for the other company`,
    ok: (row?.wrong ?? 0) > 0 && leaked === 0,
    detail:
      leaked === 0
        ? `Member sees nothing of the other company across all three tables the history tools read. Own-company commitments visible to this member: ${row?.own ?? "?"} (reported, not asserted — existing product visibility, unchanged by this feature).`
        : `LEAK: ${leaked} row(s) of another company were visible to an ordinary member.`,
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
  // PERSON-SCOPED tables: no company_id, and no company-scoped caller
  // can read them at all.
  //
  // Every standard check here derives its control caller from the
  // companies that have rows in the table, because until
  // coach_memories every table in this schema was company-scoped. On
  // a person-scoped table that derivation is not merely unavailable,
  // it is the wrong question: the control cannot be "an ordinary
  // member of a company with rows here" when the whole claim is that
  // no such person can read a row.
  //
  // So the batch supplies its own control. `control` is SQL returning
  // one (id, role) — the identity that SHOULD be able to read — and
  // `seed` is run as postgres with $caller replaced by that id, so
  // the control has something to see. Isolation is skipped and says
  // why: tenant isolation is not the mechanism protecting these
  // tables, and a green from a check that does not apply is worse
  // than an honest skip.
  personScoped?: Readonly<Record<string, { control: string; seed: string }>>;
  // Tables this batch CREATES. There is no "before" to measure on a
  // table that does not exist yet, and every before/after pair here
  // assumes one — reasonably, because until now every batch rewrote
  // policies on tables that were already there. Listing a table here
  // makes the before side report "did not exist" instead of erroring,
  // which is the truthful answer and the only one available.
  newTables?: readonly string[];
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
  // ---- coach_memories: the access wall --------------------------
  //
  // Not an F8 hoist and not a widening. A new table whose entire
  // claim is a NEGATIVE one — that nobody except the subject can read
  // it — and a negative claim is exactly the kind that passes by
  // accident. Every zero below stands beside a control that proves
  // the row it failed to read exists.
  //
  // system_admin is probed FIRST and reported FIRST because it is the
  // promise. The others are refused by policies that at least have a
  // shape somebody might expect; the platform's highest role being
  // refused is the thing a reader should not have to scroll for.
  {
    n: "coach-memory",
    tables: ["coach_memories"],
    migration: "0194_coach_memories.sql",
    newTables: ["coach_memories"],
    personScoped: {
      coach_memories: {
        // The one identity that can read a row: the subject. Any
        // active team member will do — the claim is about the
        // relationship, not the person.
        control: `select id, role from public.profiles
                   where role = 'team_member' and status = 'active'
                     and company_id is not null limit 1;`,
        seed: `insert into public.coach_memories (profile_id, kind, content)
                 values ('$caller', 'said', 'harness fixture: deleted-user control');`,
      },
    },
    writeProbes: {
      fixtures: `
        select
          m.id as subject,
          m.company_id as subject_company,
          (select id from public.profiles where role = 'system_admin'
             and status = 'active' limit 1) as sysadmin,
          (select id from public.profiles where role = 'company_admin'
             and status = 'active' and company_id = m.company_id limit 1) as admin,
          (select p.id from public.profiles p
             join public.guide_assignments ga on ga.guide_id = p.id
            where p.role = 'aims_guide' and p.status = 'active'
              and ga.company_id = m.company_id limit 1) as guide,
          -- A CONSTANT, seeded per probe. The clone has no
          -- portfolio_admin of its own, and a fixture that comes back
          -- null reports NOT PROVEN — correctly, because a probe
          -- against a missing caller returns 0 and reads like a
          -- denial. Same approach the portfolio write probes take.
          'aaaaaaaa-0000-4000-8000-000000000009'::uuid as portfolio,
          (select id from public.profiles where company_id = m.company_id
             and id <> m.id and status = 'active' limit 1) as colleague
        from public.profiles m
        where m.role = 'team_member' and m.status = 'active'
          and m.company_id is not null
        limit 1;`,
      probes: [
        // THE PROMISE. First, because it is the claim the table exists
        // to make.
        {
          name: "system_admin reads the subject's memory",
          caller: "sysadmin",
          setup:
            "insert into public.coach_memories (profile_id, kind, content) values ('$subject', 'said', 'harness fixture: wall probe');",
          sql: "select count(*)::int as n from public.coach_memories where profile_id = '$subject';",
          expect: "0",
          provenBy: "subject",
        },
        {
          name: "portfolio_admin reads the subject's memory",
          caller: "portfolio",
          setup:
            "insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at) values ('aaaaaaaa-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'harness-memory-pa@example.invalid', '', now(), now(), now()); insert into public.profiles (id, company_id, full_name, role, status) values ('aaaaaaaa-0000-4000-8000-000000000009', null, 'Harness Memory PA', 'portfolio_admin', 'active'); insert into public.coach_memories (profile_id, kind, content) values ('$subject', 'said', 'harness fixture: wall probe');",
          sql: "select count(*)::int as n from public.coach_memories where profile_id = '$subject';",
          expect: "0",
          provenBy: "subject",
        },
        {
          name: "company_admin reads their own report's memory",
          caller: "admin",
          setup:
            "insert into public.coach_memories (profile_id, kind, content) values ('$subject', 'said', 'harness fixture: wall probe');",
          sql: "select count(*)::int as n from public.coach_memories where profile_id = '$subject';",
          expect: "0",
          provenBy: "subject",
        },
        {
          name: "aims_guide reads a memory in a company they are assigned",
          caller: "guide",
          setup:
            "insert into public.coach_memories (profile_id, kind, content) values ('$subject', 'said', 'harness fixture: wall probe');",
          sql: "select count(*)::int as n from public.coach_memories where profile_id = '$subject';",
          expect: "0",
          provenBy: "subject",
        },
        {
          name: "a colleague in the same company reads it",
          caller: "colleague",
          setup:
            "insert into public.coach_memories (profile_id, kind, content) values ('$subject', 'said', 'harness fixture: wall probe');",
          sql: "select count(*)::int as n from public.coach_memories where profile_id = '$subject';",
          expect: "0",
          provenBy: "subject",
        },
        // THE CONTROL every zero above is standing beside.
        {
          name: "the subject reads their own memory",
          caller: "subject",
          setup:
            "insert into public.coach_memories (profile_id, kind, content) values ('$subject', 'said', 'harness fixture: wall probe');",
          sql: "select count(*)::int as n from public.coach_memories where profile_id = '$subject';",
          expect: "1",
        },
        // UPDATE is refused at the PRIVILEGE level, not by returning
        // an empty set. 42501 is the difference between "the database
        // declined" and "you happened to match no rows", and only one
        // of those keeps being true when somebody adds a policy.
        {
          name: "the subject updates their own memory",
          caller: "subject",
          setup:
            "insert into public.coach_memories (profile_id, kind, content) values ('$subject', 'said', 'harness fixture: wall probe');",
          sql: "with u as (update public.coach_memories set content = 'rewritten' where profile_id = '$subject' returning id) select count(*)::int as n from u;",
          expect: "42501",
        },
        {
          name: "system_admin updates the subject's memory",
          caller: "sysadmin",
          setup:
            "insert into public.coach_memories (profile_id, kind, content) values ('$subject', 'said', 'harness fixture: wall probe');",
          sql: "with u as (update public.coach_memories set content = 'rewritten' where profile_id = '$subject' returning id) select count(*)::int as n from u;",
          expect: "42501",
        },
        // Deletion is the subject's right, and nobody else's.
        {
          name: "the subject deletes their own memory",
          caller: "subject",
          setup:
            "insert into public.coach_memories (profile_id, kind, content) values ('$subject', 'said', 'harness fixture: wall probe');",
          sql: "with d as (delete from public.coach_memories where profile_id = '$subject' returning id) select count(*)::int as n from d;",
          expect: "1",
        },
        {
          name: "company_admin deletes their report's memory",
          caller: "admin",
          setup:
            "insert into public.coach_memories (profile_id, kind, content) values ('$subject', 'said', 'harness fixture: wall probe');",
          sql: "with d as (delete from public.coach_memories where profile_id = '$subject' returning id) select count(*)::int as n from d;",
          expect: "0",
          provenBy: "subject",
        },
        {
          name: "system_admin deletes the subject's memory",
          caller: "sysadmin",
          setup:
            "insert into public.coach_memories (profile_id, kind, content) values ('$subject', 'said', 'harness fixture: wall probe');",
          sql: "with d as (delete from public.coach_memories where profile_id = '$subject' returning id) select count(*)::int as n from d;",
          expect: "0",
          provenBy: "subject",
        },
        // Writing for somebody else, through the only write path there
        // is. profile_id is not a parameter, so the attempt cannot even
        // be spelled — this probes that the function writes for the
        // CALLER, which is the same guarantee read from the other side.
        // The write path has no parameter for WHOSE memory to write,
        // so the only thing to prove is where a row actually lands.
        // Asserted positively — the earlier version asked the subject
        // to confirm a row it could never see either way, and a
        // control that cannot succeed is not a control.
        {
          name: "record_coach_memory writes for the CALLER, not a target",
          caller: "admin",
          // TWO STATEMENTS, deliberately. A single statement cannot
          // see its own insert: the function runs inside the CTE, and
          // the outer query reads the snapshot taken when the
          // statement began, so the row it just wrote is invisible to
          // it. The first version counted 0 and looked like the
          // function had refused.
          sql: "select public.record_coach_memory('said', 'harness fixture: authorship probe');\nselect count(*)::int as n from public.coach_memories where profile_id = '$admin' and content = 'harness fixture: authorship probe';",
          expect: "1",
        },
        {
          name: "and that row is not readable by the subject it mentions",
          caller: "subject",
          setup:
            "insert into public.coach_memories (profile_id, kind, content) values ('$admin', 'said', 'harness fixture: the admin''s own memory');",
          sql: "select count(*)::int as n from public.coach_memories where profile_id = '$admin';",
          expect: "0",
          provenBy: "admin",
        },
      ],
    },
  },
  {
    n: "1",
    tables: ["companies", "company_features", "quarters"],
    migration: "0175_f8_batch1_hoist.sql",
  },
  {
    // Not an F8 hoist. A new role with a new read surface, measured
    // the same way because the question is the same one: what does
    // each caller see, and what does the plan cost to decide it.
    //
    // Five tables chosen to cover every shape 0191 has: a direct
    // NOT NULL company_id (commitments, priorities), a direct
    // NULLABLE one where an unrouted row must stay invisible
    // (meetings), the table where the caller's own row is the
    // carve-out (profiles), and the container itself (companies).
    n: "portfolio",
    tables: ["commitments", "priorities", "meetings", "profiles", "companies"],
    migration:
      "0190_portfolio_admin_role.sql," +
      "0191_portfolio_admin_reads.sql," +
      "0192_portfolio_admin_container_writes.sql",
    // These policies add a grant; they do not rewrite an existing one,
    // so "the helper is hoisted after" is not this batch's claim. The
    // plans are still reported: a permissive policy added beside
    // another should not change what the existing callers cost.
    judgesHoist: false,
    // The clone holds no unrouted meeting, so the nullable check
    // would measure an empty table and call the zero a denial.
    // Same row batch 5 seeds, for the same reason.
    nullCompanyRows: {
      meetings:
        "insert into public.meetings (id, company_id, provider_file_id, file_name, content_hash, transcript_text, status) " +
        "values ('44444444-4444-4444-8444-444444444444', null, '_probe_file', 'probe.txt', '_probe_hash', 'probe transcript', 'pending');",
    },
    nullCompanyExclude: {
      // Everyone may read their own profile, so a company-less caller
      // sees exactly one company-less row: theirs. Batch 6f's
      // carve-out, needed here for the same reason and not because
      // anything in 0191 widened it — profiles_select_portfolio
      // carries `company_id is not null`.
      profiles: "id <> (select auth.uid())",
    },
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
          // WENT STALE, AND THE STALENESS IS THE INTERESTING PART.
          //
          // This expected 42501 and was right when batch 5 shipped:
          // migration 0180 landed while transcript_sources admitted
          // only system_admin to INSERT. Migration 0181, the very
          // next one, created transcript_sources_insert_company_admin
          // on purpose — that was the whole point of the transcript
          // grants PR — and this line was not updated with it.
          //
          // So a standing probe has been asserting the pre-0181
          // answer ever since, and nothing noticed, because batch 5's
          // report had already been accepted and nobody re-ran it.
          // It surfaced when the portfolio_admin work re-ran every
          // batch as a regression, which is the argument for doing
          // that rather than trusting the reports on file.
          //
          // Before and after agreed at 1 throughout, so the schema is
          // right and it is this expectation that was wrong.
          name: "company_admin connects a folder",
          caller: "admin",
          sql: "with i as (insert into public.transcript_sources (company_id, scope, provider, folder_id, folder_name) values ('$admin_company', 'company', 'google_drive', '_probe_connect', 'probe') returning id) select count(*)::int as n from i;",
          expect: "1",
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
  {
    n: "us",
    tables: ["user_strengths"],
    migration: "0188_user_strengths_hoist.sql",
    // The judge cannot settle this one, and says so rather than being
    // widened until it agrees.
    //
    // afterPlanIsHoisted asks for auth_profile to be absent from the
    // plan or evaluated once. This predicate's third branch does a
    // per-row lookup into profiles, so the helper is evaluated a
    // CONSTANT number of times - 13 - rather than zero. On the
    // clone's four-row table 13 > 4 and the rule fires. The property
    // that matters is that the count does not grow with the table,
    // and that needs two scales to see:
    //
    //   before   4 rows -> loops=4      5000 rows -> loops=5000
    //   after    4 rows -> loops=13     5000 rows -> loops=13
    //
    // 92.6 ms to 2.8 ms at 5000 rows for a company member. A
    // system_admin short-circuits on the first branch and auth_profile
    // leaves their plan entirely, which the judge does accept.
    judgesHoist: false,
    indirectScope: {
      user_strengths: {
        key: "id",
        rows:
          "select u.id as key, p.company_id from public.user_strengths u " +
          "join public.profiles p on p.id = u.user_id",
      },
    },
    isolationSeed: {
      user_strengths:
        "insert into public.user_strengths (user_id, kind, label) " +
        "select p.id, 'strength', 'probe strength' from public.profiles p " +
        " where p.company_id is not null " +
        "   and p.company_id not in (select p2.company_id from public.user_strengths u " +
        "        join public.profiles p2 on p2.id = u.user_id where p2.company_id is not null) " +
        " order by p.company_id, p.id limit 1;",
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
          (select id from public.profiles where role = 'company_admin' and status = 'active'
             and company_id is not null and company_id <> (select id from c) limit 1) as other_admin;`,
      probes: [
        // The subject's own row: the branch that must survive for a
        // person to manage their own strengths.
        {
          name: "subject adds a strength to themselves",
          caller: "member",
          sql: "with i as (insert into public.user_strengths (user_id, kind, label) values ('$member', 'strength', 'probe') returning id) select count(*)::int as n from i;",
          expect: "1",
        },
        {
          // SELECT admits any colleague; INSERT does not. A plain
          // team member may not write a colleague's strengths.
          name: "team member adds a strength to a COLLEAGUE",
          caller: "member",
          sql: "with i as (insert into public.user_strengths (user_id, kind, label) values ('$colleague', 'strength', 'probe') returning id) select count(*)::int as n from i;",
          expect: "42501",
        },
        {
          name: "company_admin adds a strength to a member of its company",
          caller: "admin",
          sql: "with i as (insert into public.user_strengths (user_id, kind, label) values ('$member', 'strength', 'probe') returning id) select count(*)::int as n from i;",
          expect: "1",
        },
        {
          name: "company_admin of ANOTHER company adds one",
          caller: "other_admin",
          sql: "with i as (insert into public.user_strengths (user_id, kind, label) values ('$member', 'strength', 'probe') returning id) select count(*)::int as n from i;",
          expect: "42501",
        },
        {
          // SELECT is wider than the write policies: a colleague can
          // READ what they cannot write. Both halves stated.
          name: "team member READS a colleague's strengths",
          caller: "member",
          setup:
            "insert into public.user_strengths (id, user_id, kind, label) " +
            "values ('12121212-1212-4121-8121-121212121212', '$colleague', 'strength', 'probe');",
          sql: "select count(*)::int as n from public.user_strengths where id = '12121212-1212-4121-8121-121212121212';",
          expect: "1",
        },
        {
          name: "team member reads a strength in ANOTHER company",
          caller: "member",
          setup:
            "insert into public.user_strengths (id, user_id, kind, label) " +
            "select '13131313-1313-4131-8131-131313131313', p.id, 'strength', 'probe' " +
            "from public.profiles p where p.company_id is not null " +
            "  and p.company_id <> '$company' limit 1;",
          sql: "select count(*)::int as n from public.user_strengths where id = '13131313-1313-4131-8131-131313131313';",
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
  // Present on the live query; optional so the pure matchers above can
  // still be unit-tested with hand-made rows that have no command.
  cmd?: string;
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

// ---- Where portfolio_admin may WRITE ---------------------------
//
// THE RULE. portfolio_admin has instance-wide READ (0191, forty-nine
// policies) and a closed list of administrative writes on the
// CONTAINER (0192). The list is closed, which means the interesting
// question is not "does the grant work" but "has anything been added
// to it since". A write policy naming this role on any other table is
// a content grant, and a content grant is the one thing this role is
// defined by not having.
//
// Why a static check rather than a probe. A probe answers "can this
// role write to commitments TODAY", which is a question about the
// tables somebody thought to probe. This answers "does a write policy
// anywhere in the schema name this role", which is a question about
// the schema. The F8 series is full of tables nobody thought to
// check; sixty-four of them carry RLS.
//
// ---- WHAT THIS CHECK NO LONGER COVERS, AS OF 0199 ---------------
//
// It matches policies that NAME the role. From 0199 a portfolio admin
// can also reach a company's content through is_admin_for(), a
// function that never mentions `portfolio_admin` — so those writes
// are invisible here, and this check would keep passing while the
// boundary it describes stopped being true.
//
// A guard that passes while its claim is false is worse than no
// guard, because it is read as evidence. So the claim is narrowed:
// this check now says "no write policy NAMES the role outside the
// list", which is exactly what it tests, and the boundary that
// actually matters — what a portfolio admin can reach WITHOUT an
// assignment — is asserted at runtime by the permanent
// `portfolio-assignment-boundary` case. Neither is sufficient alone.
export const PORTFOLIO_WRITE_ALLOWLIST: readonly string[] = [
  // Item 4, added 0199. Their own assignment rows: which companies
  // they hold admin rights in. Container, not content — it is about
  // access to companies rather than anything a company produced,
  // which is the line the other four sit on. Self-assignable by
  // design (spec §1a decision 2); the policy's `ap.uid =
  // portfolio_admin_id` clause is what stops it assigning anybody
  // else, and that clause is probed rather than trusted.
  "portfolio_assignments",
  // Item 1: create a company. Item 2, half of it: settings, within
  // the column allowlist enforced by companies_restrict_admin_columns.
  "companies",
  // Item 2, the other half: feature flags, insert and delete.
  "company_features",
  // Item 3: invite users into company-scoped roles. INSERT only, and
  // the policy carries the role ceiling in SQL.
  "profiles",
  // Not one of the three. The role's own audit trail, which it writes
  // and cannot read, update or delete. Allowlisted because the
  // accountability layer would otherwise be the thing this check
  // fails on, and a check that fails on its own safeguard gets
  // switched off.
  "portfolio_admin_events",
];

// Matches the helper AND the bare string. A policy could name the role
// either way — `(select public.is_portfolio_admin())` is the idiom
// 0190 established, but `auth_role() = 'portfolio_admin'` would work
// just as well and would be just as much of a grant. A matcher that
// only knew the idiom would be blind to the spelling somebody reaches
// for when they are in a hurry, which is exactly when this goes wrong.
const PORTFOLIO_MENTION = /is_portfolio_admin|'portfolio_admin'/i;

export function portfolioWritePolicies(rows: readonly PolicyRow[]): string[] {
  return rows
    .filter((r) => (r.cmd ?? "SELECT").toUpperCase() !== "SELECT")
    .filter((r) => PORTFOLIO_MENTION.test(`${r.qual ?? ""} ${r.with_check ?? ""}`))
    .map((r) => `${r.tablename}.${r.policyname}`);
}

export function portfolioWriteOffenders(rows: readonly PolicyRow[]): string[] {
  return portfolioWritePolicies(rows).filter(
    (name) => !PORTFOLIO_WRITE_ALLOWLIST.includes(name.split(".")[0])
  );
}

// The deliberately wrong policy this check is proved against.
//
// Written onto a content table inside the probe transaction and rolled
// back with it. If the matcher does not report it, the matcher is
// broken and a clean live result means nothing — the same reasoning as
// the IS DISTINCT FROM canary, except that here the canary cannot be
// an existing policy, because the whole claim is that no such policy
// exists.
// SPELLED AS A BARE ROLE COMPARISON, not with the helper.
//
// Two reasons, and the second was found the hard way. The helper only
// exists once 0190 is applied, so a canary written with it CRASHES
// the whole harness on any schema where the role has not landed —
// which is every run that is not this batch, including the F8
// regression runs this migration has to pass. A check that takes the
// instrument down when the feature is absent is worse than no check.
//
// And it is the better canary regardless: the bare spelling is the
// one somebody reaches for in a hurry, so proving the matcher catches
// THAT proves the harder half.
const PORTFOLIO_CANARY_POLICY = `
create policy zz_portfolio_canary on public.commitments
for update to authenticated
using ((select public.auth_role()) = 'portfolio_admin')
with check ((select public.auth_role()) = 'portfolio_admin');`;

async function portfolioAllowlistCheck(
  run: Runner,
  pending: string
): Promise<BatchCheck> {
  const POLICY_QUERY = `
    select tablename, policyname, cmd, qual, with_check
      from pg_policies where schemaname = 'public'
     order by tablename, policyname;`;

  // Live, with the batch's migrations applied and rolled back so the
  // check reads the schema the PR is asking for.
  const live = await run<PolicyRow>(
    ["begin;", pending, POLICY_QUERY, "rollback;"].join("\n")
  );
  const granted = portfolioWritePolicies(live);
  const offenders = portfolioWriteOffenders(live);

  // The same measurement with one content-table write policy added.
  const canaryRows = await run<PolicyRow>(
    ["begin;", pending, PORTFOLIO_CANARY_POLICY, POLICY_QUERY, "rollback;"].join("\n")
  );
  const caught = portfolioWriteOffenders(canaryRows).includes(
    "commitments.zz_portfolio_canary"
  );

  // On a schema where the role has not landed yet there is nothing to
  // police, and saying so is the honest answer. The canary still has
  // to fire — the matcher is what is being vouched for, and it works
  // whether or not the role exists.
  if (granted.length === 0) {
    return {
      name: "static portfolio_admin write allowlist",
      before: "0 write policies name the role",
      after: caught
        ? "not applicable: portfolio_admin is not on this schema (matcher verified)"
        : "CHECK IS BROKEN: a deliberately wrong policy was NOT caught",
      ok: caught,
      detail: caught
        ? "nothing to police here, and the matcher still catches a planted grant"
        : "the matcher missed a planted content grant",
    };
  }

  const ok = offenders.length === 0 && caught;
  return {
    name: "static portfolio_admin write allowlist",
    before:
      `${granted.length} write policies name the role` +
      (granted.length > 0 ? ` (${granted.join(", ")})` : ""),
    after: !caught
      ? "CHECK IS BROKEN: a deliberately wrong policy on commitments was NOT caught"
      : offenders.length === 0
        ? `no write policy NAMES the role outside (${PORTFOLIO_WRITE_ALLOWLIST.join(", ")}); reach via is_admin_for() is asserted by the portfolio-assignment-boundary case, not here`
        : `OUTSIDE THE ALLOWLIST: ${offenders.join(", ")}`,
    ok,
    detail: !caught
      ? "the matcher missed a planted content grant, so it cannot vouch for the real ones"
      : offenders.length === 0
        ? "no write policy names portfolio_admin outside the container tables, and a planted content grant is caught. This does NOT say the role cannot reach content — assignment-derived reach is the boundary case's claim."
        : "portfolio_admin has a write policy on a table outside the closed list",
  };
}

// PERMANENT COVERAGE for coach_memories. Runs on every invocation,
// not on request, because a guard you have to remember to ask for is
// not a guard.
//
// Three claims, all negative, all of the kind that pass by accident:
//   1. No policy on the table names ANY role. The wall is "profile_id
//      = auth.uid()" and nothing else, so a role branch appearing
//      later is a visible, deliberate act rather than a line in a
//      larger migration.
//   2. UPDATE is not GRANTED to `authenticated`. An UPDATE policy is
//      now expected (0197, editing), and the distinction between the
//      two is the entire lesson of E8: the policy says which rows a
//      verb may touch, the grant says whether the verb runs at all.
//      Editing goes through update_coach_memory, a definer function
//      with no profile_id parameter, so the privilege stays revoked
//      and a direct UPDATE from the app is still refused with 42501.
//      The policy is required only because the table is FORCE ROW
//      LEVEL SECURITY, which subjects the definer's owner to policies
//      too — the same arrangement INSERT has had since 0194.
//   3. service_role cannot read it. Every other table in this schema
//      relies on RLS alone and 0004's own comment says why that is
//      enough there: "service_role bypasses RLS via GRANT anyway". On
//      THIS table that is not enough, because "system_admin cannot
//      read it" is worth nothing if any code holding the service key
//      can. BYPASSRLS bypasses policies, not GRANTs, so the table is
//      revoked from the role — and that is measured here rather than
//      reasoned about.
//
// Canary: a planted system_admin SELECT policy must be caught. If it
// is not, the matcher is broken and a clean result proves nothing.
const MEMORY_CANARY_POLICY = `
create policy zz_memory_canary on public.coach_memories
  for select to authenticated
  using (public.auth_role() = 'system_admin');`;

function memoryRoleOffenders(rows: readonly PolicyRow[]): string[] {
  const ROLES = /system_admin|company_admin|aims_guide|portfolio_admin/;
  return rows
    .filter((r) => r.tablename === "coach_memories")
    .filter((r) => ROLES.test(`${r.qual ?? ""} ${r.with_check ?? ""}`))
    .map((r) => `${r.tablename}.${r.policyname}`);
}

async function coachMemoryWallCheck(
  run: Runner,
  pending: string
): Promise<BatchCheck> {
  const POLICY_QUERY = `
    select tablename, policyname, cmd, qual, with_check
      from pg_policies where schemaname = 'public'
     order by tablename, policyname;`;

  const live = await run<PolicyRow>(
    ["begin;", pending, POLICY_QUERY, "rollback;"].join("\n")
  );
  const mine = live.filter((r) => r.tablename === "coach_memories");

  // Nothing to police until the table lands. The canary still has to
  // fire, because the matcher is the thing being vouched for.
  const canaryRows = await run<PolicyRow>(
    [
      "begin;",
      pending,
      mine.length > 0 ? MEMORY_CANARY_POLICY : "",
      POLICY_QUERY,
      "rollback;",
    ].join("\n")
  );
  const caught = memoryRoleOffenders(canaryRows).includes(
    "coach_memories.zz_memory_canary"
  );

  if (mine.length === 0) {
    return {
      name: "coach_memories access wall",
      before: "table not on this schema",
      after: "not applicable: coach_memories has not landed here yet",
      ok: true,
      detail:
        "nothing to police; the check activates with the table and the matcher is exercised the moment it does",
    };
  }

  const offenders = memoryRoleOffenders(live);
  // Expected as of 0197. Asserted PRESENT rather than merely
  // tolerated: without it the definer function is refused along with
  // everybody else, and editing fails in a way that looks like a bug
  // in the action rather than a missing policy.
  const hasUpdate = mine.some((r) => r.cmd === "UPDATE");

  // service_role, measured. `set local role` drops the superuser
  // connection into the role the app's service key would use.
  const [priv] = await run<{
    denied: boolean;
    no_update: boolean;
    no_insert: boolean;
  }>(
    [
      "begin;",
      pending,
      `select
         not has_table_privilege('service_role', 'public.coach_memories', 'select')
           as denied,
         not has_table_privilege('authenticated', 'public.coach_memories', 'update')
           as no_update,
         not has_table_privilege('authenticated', 'public.coach_memories', 'insert')
           as no_insert;`,
      "rollback;",
    ].join("\n")
  );
  const serviceDenied = priv?.denied === true;
  // The PRIVILEGE, not just the missing policy. Supabase's default
  // privileges grant ALL on every new table in public, so "no UPDATE
  // policy" and "cannot UPDATE" are different claims and the first
  // one shipped while the second was false.
  const noUpdatePriv = priv?.no_update === true;
  const noInsertPriv = priv?.no_insert === true;

  const ok =
    offenders.length === 0 &&
    hasUpdate &&
    serviceDenied &&
    noUpdatePriv &&
    noInsertPriv &&
    caught;
  const faults = [
    offenders.length > 0 ? `policies naming a role: ${offenders.join(", ")}` : null,
    hasUpdate ? null : "the UPDATE policy is missing; editing cannot work",
    noUpdatePriv ? null : "authenticated still HOLDS the UPDATE privilege",
    noInsertPriv ? null : "authenticated can INSERT directly, bypassing the write path",
    serviceDenied ? null : "service_role can still SELECT the table",
    caught ? null : "CHECK IS BROKEN: a planted system_admin policy was NOT caught",
  ].filter(Boolean);

  return {
    name: "coach_memories access wall",
    before: `${mine.length} policies on the table (${mine.map((r) => r.cmd).join(", ")})`,
    after:
      faults.length === 0
        ? "no role branch, no UPDATE or INSERT privilege, edit and write only via definer functions, service_role has no SELECT privilege"
        : faults.join(" | "),
    ok,
    detail:
      faults.length === 0
        ? "the subject is the only identity that can reach memory, and a planted system_admin policy is caught"
        : "the access wall does not hold",
  };
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

// One file, or several separated by commas.
//
// Every F8 batch was a single migration. The portfolio_admin batch is
// three — role, reads, writes — because the read surface is fifty
// policies of mechanical shape and the write surface is six that each
// need reading carefully, and a reviewer should not have to find the
// second inside the first. They land together and are measured
// together, which is what makes them one batch.
function migrationSql(batch: Batch): string {
  return batch.migration
    .split(",")
    .map((f) => readFileSync(`supabase/migrations/${f.trim()}`, "utf8"))
    .join("\n");
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
    const person = batch.personScoped?.[table];
    // A control the table's read policy actually admits. Person-scoped
    // tables name their own; everything else derives one from the
    // companies holding rows.
    const candidates = person
      ? await run<{ id: string; role: string }>(
          ["begin;", sql, person.control, "rollback;"].join("\n")
        )
      : await run<{ id: string; role: string }>(
          controlCandidatesSql(batch, table)
        );
    // If the batch knows how to make a row here, use it: a table that
    // happens to be empty on this clone would otherwise report every
    // caller as unable to read it, which proves nothing either way.
    const seed = person
      ? person.seed.replaceAll("$caller", candidates[0]?.id ?? "")
      : (batch.seedRows?.[table] ?? batch.nullCompanyRows?.[table] ?? "");
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
    const isNew = batch.newTables?.includes(table) ?? false;
    const [before] = isNew
      ? [{ n: 0 }]
      : await run<{ n: number }>(asCaller(ids.nobody, seed, count));
    const [after] = await run<{ n: number }>(asCaller(ids.nobody, withSeed, count));
    const proven = control.n > 0;
    const ok = before.n === 0 && after.n === 0 && proven;
    out.push({
      name: `deleted user · ${table}`,
      before: isNew ? "table did not exist" : `${before.n} row(s)`,
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
    // A person-scoped table has no tenant boundary to test. Reported
    // as not applicable rather than passed: a green from a check that
    // did not ask its question reads exactly like a green from one
    // that did, and only one of them is evidence.
    if (batch.personScoped?.[table]) {
      out.push({
        name: `isolation · ${table}`,
        before: "n/a",
        after: "not applicable: person-scoped, no company_id and no tenant read path",
        ok: true,
        detail:
          "tenant isolation is not the mechanism protecting this table; the access wall is, and the write probes assert it caller by caller",
      });
      continue;
    }
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
  if (before === "table did not exist") {
    // Nothing to compare against; the after side carries the whole
    // claim, and the control beside it is what makes a zero evidence.
    return after === expect
      ? {
          ok: control === undefined || control !== "0",
          detail:
            control === undefined
              ? "new table: the after side is the claim"
              : control !== "0"
                ? "new table: refused, and the control caller can read the row it failed to read"
                : "NOT PROVEN: the control also saw nothing, so this zero is not evidence",
        }
      : { ok: false, detail: `expected ${expect}, got ${after}` };
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
    // A table this batch creates has no "before": the statement would
    // run against a relation that does not exist, and an undefined-
    // table error is not a measurement of anything. Reported as such
    // rather than compared.
    const createsTable = (batch.newTables ?? []).some((t) =>
      probe.sql.includes(`public.${t}`)
    );
    const before = createsTable
      ? "table did not exist"
      : await runAs(caller as string, setup, statement);
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
    // A table this batch creates cannot be counted or EXPLAINed on
    // the before side, and the plan comparison is the whole point of
    // this section — there is no prior plan to have moved. Reported
    // rather than skipped silently.
    if ((batch.newTables ?? []).includes(table)) {
      lines.push(`  ${table} (created by this batch)`);
      lines.push(
        "    no before/after plan pair: the table does not exist on the current schema,"
      );
      lines.push(
        "    so there is no prior plan a rewrite could have moved. The access wall is"
      );
      lines.push("    asserted by the write probes above, not by a plan shape.");
      continue;
    }
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
      `  ${(p.ok ? "PASS" : "FAIL").padEnd(6)}${p.name.padEnd(46)}${p.detail}`
    );
    lines.push(`  ${"".padEnd(6)}${"".padEnd(46)}granted:  ${p.granted}`);
    lines.push(`  ${"".padEnd(6)}${"".padEnd(46)}withheld: ${p.withheld}`);
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
    // Both of the column guard's messages, not one. 0192 added a
    // second branch to companies_restrict_admin_columns with its own
    // wording, and a matcher that knew only the first reported it as
    // an unexplained ERROR — which reads as a broken probe rather than
    // as the guard working. Found by the portfolio delete probe.
    if (
      /insufficient_privilege|Only industry may be changed|may change only name, timezone/i.test(
        msg
      )
    ) {
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

  // ---- The baseline function role, and who may touch it --------
  //
  // function_roles holds one row per function flagged is_default,
  // carrying "Lead, Track, Decide". 0107 states it is immutable and
  // that RLS is what makes it so.
  //
  // It was true of system_admin and company_admin and false of
  // aims_guide: the guide mirrors in 0111 copied the tenant predicate
  // and dropped the is_default clause, so a guide could edit and
  // delete the baseline row a SYSTEM ADMIN cannot. Migration 0193
  // closes it.
  //
  // THIS IS THE CASE THE PROBE RULE WAS WRITTEN FOR. A guard that
  // refuses two roles looks like a guard that refuses everybody, and
  // the only way to find out is to try the third. Two zeros are not a
  // proof that a third caller would also get zero.
  const [frFixture] = await run<{
    guide: string | null;
    sysadmin: string | null;
    default_role: string | null;
    editable_role: string | null;
  }>(`
    select
      p.id as guide,
      (select id from public.profiles
        where role = 'system_admin' and status = 'active' limit 1) as sysadmin,
      (select fr.id from public.function_roles fr
         join public.functions f on f.id = fr.function_id
        where f.company_id = ga.company_id and fr.is_default limit 1) as default_role,
      (select fr.id from public.function_roles fr
         join public.functions f on f.id = fr.function_id
        where f.company_id = ga.company_id and not fr.is_default limit 1) as editable_role
    from public.profiles p
    join public.guide_assignments ga on ga.guide_id = p.id
    where p.role = 'aims_guide' and p.status = 'active'
      and exists (
        select 1 from public.function_roles fr
          join public.functions f on f.id = fr.function_id
         where f.company_id = ga.company_id and fr.is_default)
    limit 1;`);

  if (!frFixture?.guide || !frFixture.default_role || !frFixture.sysadmin) {
    probes.push({
      name: "default role lock · aims_guide",
      granted: "not attempted",
      withheld: "not attempted",
      ok: false,
      detail: "NOT PROVEN: the clone has no guide with a default role to try",
    });
  } else {
    const renameDefault = (id: string) =>
      `update public.function_roles set title = 'harness probe' ` +
      `where id = '${id}' returning id;`;
    const deleteDefault = (id: string) =>
      `delete from public.function_roles where id = '${id}' returning id;`;

    const guideEdits = await attempt(
      frFixture.guide,
      renameDefault(frFixture.default_role)
    );
    const guideDeletes = await attempt(
      frFixture.guide,
      deleteDefault(frFixture.default_role)
    );
    // The control, and it is the half that makes the zeros mean
    // something: the same guide, the same table, a row they SHOULD be
    // able to edit. Without it "0 rows" is indistinguishable from a
    // guide who cannot write function_roles at all.
    const guideControl = frFixture.editable_role
      ? await attempt(frFixture.guide, renameDefault(frFixture.editable_role))
      : "no non-default role on this company to control with";
    // And the system_admin, who has always been refused here. If this
    // stops being refused, the fix went too wide.
    const sysDefault = await attempt(
      frFixture.sysadmin,
      renameDefault(frFixture.default_role)
    );

    const ok =
      guideEdits.startsWith("0 rows") &&
      guideDeletes.startsWith("0 rows") &&
      guideControl.includes("row(s) written") &&
      sysDefault.startsWith("0 rows");

    probes.push({
      name: "default role lock · aims_guide",
      granted: `control, guide renames a NON-default role: ${guideControl}`,
      withheld:
        `guide renames the default: ${guideEdits} | guide deletes it: ` +
        `${guideDeletes} | system_admin renames it: ${sysDefault}`,
      ok,
      detail: ok
        ? "the baseline row is immutable for the guide too, and the guide can still edit the others"
        : !guideControl.includes("row(s) written")
          ? "NOT PROVEN: the control could not write either, so the refusals prove nothing"
          : sysDefault.includes("row(s) written")
            ? "THE LOCK IS GONE FOR SYSTEM_ADMIN TOO: the fix went wider than the hole"
            : "THE GUIDE CAN EDIT OR DELETE THE BASELINE ROLE",
    });
  }

  // ---- Timezone: the edit path, the lock, and the record --------
  //
  // companies.timezone decides what date a row falls on for every
  // bucketed read in the app, so setCompanyTimezoneAction admits
  // system_admin and nobody else, and migration 0189 records each
  // change in company_settings_events.
  //
  // Three things have to be true, and the app can only be trusted on
  // the first of them. It is the other two that this probes:
  //
  //   the edit works        — a system_admin can actually move it
  //   the lock holds        — the roles 0176 admitted to `industry`
  //                           still cannot reach this column
  //   the record is written — and carries WHO, not just WHAT
  //
  // A log that records the change but not the actor answers half the
  // question it exists for, and it fails silently: the row is there,
  // the column is null, and nothing looks wrong until somebody needs
  // the name. actor_id comes from auth.uid() inside a SECURITY
  // DEFINER trigger, which is exactly the kind of thing that is right
  // in the migration and null in practice.

  // Read as postgres, outside the probe transaction, so the probe can
  // name both sides of the change it is about to make. Picking the
  // target in SQL would work too; naming it here is what lets the
  // event assertion be exact rather than "something was logged".
  const [tzRow] = await run<{ tz: string | null }>(
    `select timezone as tz from public.companies where id = '${ids.otherCompany}';`
  );
  const tzBefore = tzRow?.tz ?? null;
  const tzAfter = tzBefore === "UTC" ? "America/Denver" : "UTC";

  if (!tzBefore) {
    probes.push({
      name: "timezone edit · system_admin",
      granted: "not attempted",
      withheld: "not attempted",
      ok: false,
      detail: "NOT PROVEN: the probe company has no timezone to move",
    });
  } else {
    // Two statements in one rolled-back transaction. They cannot be
    // one: the trigger is AFTER UPDATE, so its rows do not exist
    // until the update statement has finished, and a data-modifying
    // CTE would count zero every time and call it enforcement.
    const move = `
      update public.companies set timezone = '${tzAfter}'
       where id = '${ids.otherCompany}';
      select
        (select count(*)::int from public.companies
          where id = '${ids.otherCompany}' and timezone = '${tzAfter}') as updated,
        (select count(*)::int from public.company_settings_events
          where company_id = '${ids.otherCompany}' and field = 'timezone'
            and old_value = '${tzBefore}' and new_value = '${tzAfter}'
            and actor_id = '${ids.systemAdmin}') as logged;`;

    let updated = -1;
    let logged = -1;
    let moveError = "";
    try {
      const rows = await run<{ updated: number; logged: number }>(
        asCaller(ids.systemAdmin, pending, move)
      );
      updated = Number(rows?.[0]?.updated ?? -1);
      logged = Number(rows?.[0]?.logged ?? -1);
    } catch (err) {
      moveError = describeOutcome(null, err);
    }

    // The same role, writing the log by hand. An append-only table
    // whose reader can also forge entries is not evidence of
    // anything, and system_admin is the strongest caller the app
    // has: if the table holds against them it holds against
    // everyone.
    const forged = await attempt(
      ids.systemAdmin,
      `insert into public.company_settings_events
         (company_id, field, old_value, new_value)
       values ('${ids.otherCompany}', 'timezone', 'forged', 'forged')
       returning id;`
    );

    const ok =
      moveError === "" &&
      updated === 1 &&
      logged === 1 &&
      (forged === "refused by RLS" || forged.startsWith("0 rows"));

    probes.push({
      name: "timezone edit · system_admin",
      granted:
        moveError !== ""
          ? `timezone ${tzBefore} to ${tzAfter}: ${moveError}`
          : `timezone ${tzBefore} to ${tzAfter}: ${updated} row(s) written, ` +
            `${logged} event(s) logged with the actor`,
      withheld: `hand-written event insert: ${forged}`,
      ok,
      detail: ok
        ? "moves the clock, leaves a record naming who moved it, and cannot forge one"
        : updated !== 1
          ? "THE EDIT DOES NOT WORK: system_admin cannot set the column the action offers"
          : logged !== 1
            ? "THE RECORD IS NOT WRITTEN as specified: no event with this old value, new value and actor"
            : "THE LOG IS WRITEABLE BY HAND: the append-only guarantee does not hold",
    });
  }

  // The lock. 0176 widened companies_update to admit these two roles
  // and relies on the column guard to keep the widening to
  // `industry`. Timezone is the column where that mattering is
  // easiest to state: a company admin who could move their own clock
  // could re-date their own scorecard history.
  //
  // Each carries its own control. A refusal measured without one is
  // indistinguishable from a caller who could not write anything at
  // all, which is the empty-set mistake on the write side.
  for (const [label, sub, own] of [
    ["company_admin", ids.companyAdmin, ids.companyAdminCompany],
    ["aims_guide", ids.guide, ids.guideCompany],
  ] as const) {
    const blocked = await attempt(
      sub,
      `update public.companies set timezone = 'UTC' where id = '${own}' returning id;`
    );
    const control = await attempt(sub, setIndustry(own));
    const ok =
      blocked === "refused by the column guard" &&
      control.includes("row(s) written");

    probes.push({
      name: `timezone lock · ${label}`,
      granted: `control, industry on the same row: ${control}`,
      withheld: `timezone on own company: ${blocked}`,
      ok,
      detail: ok
        ? "cannot move the clock on a company it otherwise administers"
        : !control.includes("row(s) written")
          ? "NOT PROVEN: the control could not write either, so the refusal proves nothing"
          : "THE LOCK IS OPEN: this role can re-date its own reporting history",
    });
  }

  return probes;
}

// ---- portfolio_admin ------------------------------------------
//
// A role with instance-wide read and a closed list of three
// administrative writes needs its evidence in one place, because the
// claim is a SHAPE rather than a list of permissions: wide read,
// narrow write, and nothing in between. Every probe below runs as a
// real portfolio_admin JWT against real tables inside a transaction
// that is rolled back.
//
// SELF-PROVISIONED FIXTURE, and it has to be. There is no
// portfolio_admin on the clone and there should not be one: a role
// this wide, sitting permanently in a database so people can test
// against it, is how a test fixture becomes a production account. So
// the probe makes one — auth.users row and profile — acts as it, and
// rolls the whole thing back. Nothing survives the transaction.
//
// Fixed uuids rather than generated ones so the assertions can name
// the caller. They are syntactically valid and belong to nobody.
const PA_UUID = "aaaaaaaa-0000-4000-8000-000000000001";
const PA_EMAIL = "harness-portfolio-admin@example.invalid";

// Four invitee slots, pre-created as auth users so the INVITE probe
// can insert profiles for them as the caller.
//
// profiles.id is foreign-keyed to auth.users, and a caller acting as
// `authenticated` cannot write auth.users — so an invite probe that
// generated its own uuids failed on the foreign key and reported
// "the role cannot invite a company admin", which was true of the
// probe and not of the role. The auth rows are made as postgres
// alongside the actor; only the profiles insert is the measurement.
const INVITEE_UUIDS = [
  "aaaaaaaa-0000-4000-8000-000000000011",
  "aaaaaaaa-0000-4000-8000-000000000012",
  "aaaaaaaa-0000-4000-8000-000000000013",
  "aaaaaaaa-0000-4000-8000-000000000014",
] as const;

function authUser(id: string, email: string): string {
  return `
insert into auth.users
  (id, instance_id, aud, role, email, encrypted_password,
   email_confirmed_at, created_at, updated_at)
values
  ('${id}', '00000000-0000-0000-0000-000000000000', 'authenticated',
   'authenticated', '${email}', '', now(), now(), now());`;
}

function portfolioFixture(): string {
  return [
    authUser(PA_UUID, PA_EMAIL),
    `insert into public.profiles (id, company_id, full_name, role, status)
values ('${PA_UUID}', null, 'Harness Portfolio Admin', 'portfolio_admin', 'active');`,
    ...INVITEE_UUIDS.map((id, i) =>
      authUser(id, `harness-invitee-${i}@example.invalid`)
    ),
  ].join("\n");
}

export type PortfolioFixtures = {
  company_a: string | null;
  company_b: string | null;
  admin_a: string | null;
  sysadmin: string | null;
  feature_a: string | null;
  spare_feature: string | null;
};

async function portfolioProbes(
  run: Runner,
  ids: Identities,
  pending: string
): Promise<GrantProbe[]> {
  const probes: GrantProbe[] = [];

  // Two companies that actually hold content, chosen in SQL so the
  // case survives a clone refresh. "Reads company A and company B" is
  // only a claim about instance-wide reach if A and B are different
  // tenants and both have something to read.
  const [fx] = await run<PortfolioFixtures>(`
    with ranked as (
      select company_id, count(*)::int as n
        from public.commitments
       where company_id is not null
       group by company_id
       order by count(*) desc
       limit 2
    )
    select
      (select company_id from ranked offset 0 limit 1) as company_a,
      (select company_id from ranked offset 1 limit 1) as company_b,
      (select p.id from public.profiles p
        where p.role = 'company_admin' and p.status = 'active'
          and p.company_id = (select company_id from ranked offset 0 limit 1)
        limit 1) as admin_a,
      (select id from public.profiles
        where role = 'system_admin' and status = 'active' limit 1) as sysadmin,
      (select feature from public.company_features
        where company_id = (select company_id from ranked offset 0 limit 1)
        limit 1) as feature_a,
      (select f.feature from (values ('classroom'),('strengths'),('role_descriptions')) f(feature)
        where not exists (
          select 1 from public.company_features cf
           where cf.company_id = (select company_id from ranked offset 0 limit 1)
             and cf.feature = f.feature)
        limit 1) as spare_feature;`);

  const missing = Object.entries(fx ?? {})
    .filter(([, v]) => v === null || v === undefined)
    .map(([k]) => k);
  if (!fx || missing.length > 0) {
    probes.push({
      name: "portfolio_admin fixtures",
      granted: "not attempted",
      withheld: "not attempted",
      ok: false,
      detail: `NOT PROVEN: the clone could not supply ${missing.join(", ")}`,
    });
    return probes;
  }

  const A = fx.company_a as string;
  const B = fx.company_b as string;

  // Every probe shares the same setup: the batch's migrations, then
  // the fixture, all as postgres before the role switch.
  const setup = `${pending}\n${portfolioFixture()}`;

  // On a schema without 0190 the role is not in profiles_role_check,
  // so the fixture itself bounces. Say that once, rather than running
  // eight probes that all fail for the same reason and read like
  // eight findings. This is what every F8 regression run sees.
  try {
    await run(asCaller(PA_UUID, setup, "select 1 as ok;"));
  } catch {
    return [
      {
        name: "portfolio_admin probes",
        granted: "not attempted",
        withheld: "not attempted",
        ok: true,
        detail:
          "not applicable: portfolio_admin is not on this schema " +
          "(run with --pending 0190_portfolio_admin_role.sql)",
      },
    ];
  }
  const attempt = async (sql: string, sub: string = PA_UUID): Promise<WriteOutcome> => {
    try {
      return describeOutcome(await run<Record<string, unknown>>(asCaller(sub, setup, sql)));
    } catch (err) {
      return describeOutcome(null, err);
    }
  };

  const numbers = async (
    sql: string,
    sub: string = PA_UUID
  ): Promise<Record<string, number> | string> => {
    try {
      const rows = await run<Record<string, number>>(asCaller(sub, setup, sql));
      return rows?.[0] ?? {};
    } catch (err) {
      return describeOutcome(null, err);
    }
  };

  // ---- 1. Instance-wide read, with the denied set beside it ----
  //
  // Two tenants, nonzero on both, is the claim. The third number is
  // what makes it mean something: a role that could see everything
  // would also see the rows that belong to no tenant, and this one
  // must not. Measured in the same statement so all three describe
  // one caller at one moment.
  const reads = await numbers(`
    select
      (select count(*)::int from public.commitments where company_id = '${A}') as a_commitments,
      (select count(*)::int from public.commitments where company_id = '${B}') as b_commitments,
      (select count(*)::int from public.priorities where company_id = '${B}') as b_priorities,
      (select count(*)::int from public.companies) as companies_seen,
      (select count(*)::int from public.coaching_conversations) as coaching_denied,
      (select count(*)::int from public.profiles
        where company_id is null and id <> (select auth.uid())) as companyless_denied,
      (select count(*)::int from public.profiles
        where company_id is null and id = (select auth.uid())) as own_row;`);
  if (typeof reads === "string") {
    probes.push({
      name: "portfolio read · two tenants",
      granted: `reads: ${reads}`,
      withheld: "not reached",
      ok: false,
      detail: "THE READ FAILED OUTRIGHT",
    });
  } else {
    const ok =
      reads.a_commitments > 0 &&
      reads.b_commitments > 0 &&
      reads.b_priorities > 0 &&
      reads.companies_seen > 1 &&
      reads.coaching_denied === 0 &&
      reads.companyless_denied === 0 &&
      // The self-row carve-out, the same shape batch 6f established.
      // Everyone may read their own profile through profiles_select's
      // `auth.uid() = id` branch, so a company-less caller sees
      // exactly one company-less row: theirs. Hazard 1 is about a
      // caller with no company matching OTHER rows with no company
      // through the tenant predicate, so the own row is excluded and
      // its presence is asserted rather than ignored — a zero here
      // would mean the caller cannot see themselves, which is a
      // different bug wearing the same number.
      reads.own_row === 1;
    probes.push({
      name: "portfolio read · two tenants",
      granted:
        `company A commitments: ${reads.a_commitments} | company B commitments: ` +
        `${reads.b_commitments} | company B priorities: ${reads.b_priorities} | ` +
        `companies visible: ${reads.companies_seen}`,
      withheld:
        `private coaching conversations: ${reads.coaching_denied} | ` +
        `other company-less profiles: ${reads.companyless_denied} ` +
        `(own row visible: ${reads.own_row})`,
      ok,
      detail: ok
        ? "reads content across tenants, and not the two sets the role is denied"
        : reads.coaching_denied > 0 || reads.companyless_denied > 0
          ? "THE READ IS TOO WIDE: it reaches a set 0191 deliberately omits"
          : "NOT PROVEN: a tenant the role should read came back empty",
    });
  }

  // ---- 2. Unrouted meetings: hazard 1's exact shape ------------
  //
  // A caller with no company, a row with no company. The row is
  // SEEDED rather than looked for: a clone with no unrouted meeting
  // would report zero and that zero would prove nothing. The control
  // is a system_admin in the same transaction seeing the same row,
  // which is what turns the portfolio_admin's zero into a denial
  // rather than an empty table.
  const seedUnrouted = `
insert into public.meetings
  (company_id, provider_file_id, file_name, content_hash, transcript_text, status)
values (null, 'harness-unrouted', 'harness-unrouted.txt',
        'harness-unrouted-hash', 'unrouted probe', 'unrouted');`;
  const unroutedSetup = `${setup}\n${seedUnrouted}`;
  const countUnrouted =
    "select count(*)::int as n from public.meetings where company_id is null;";
  let paUnrouted = "error";
  let sysUnrouted = "error";
  try {
    const r = await run<{ n: number }>(
      asCaller(PA_UUID, unroutedSetup, countUnrouted)
    );
    paUnrouted = String(r?.[0]?.n ?? "?");
  } catch (err) {
    paUnrouted = describeOutcome(null, err);
  }
  try {
    const r = await run<{ n: number }>(
      asCaller(fx.sysadmin as string, unroutedSetup, countUnrouted)
    );
    sysUnrouted = String(r?.[0]?.n ?? "?");
  } catch (err) {
    sysUnrouted = describeOutcome(null, err);
  }
  const unroutedOk = paUnrouted === "0" && Number(sysUnrouted) > 0;
  probes.push({
    name: "portfolio read · unrouted meetings",
    granted: `control, system_admin sees the seeded unrouted row: ${sysUnrouted}`,
    withheld: `portfolio_admin sees unrouted meetings: ${paUnrouted}`,
    ok: unroutedOk,
    detail: unroutedOk
      ? "a row belonging to no tenant is not in this role's instance"
      : Number(sysUnrouted) <= 0
        ? "NOT PROVEN: the control could not see the seeded row either"
        : "HAZARD 1: the role sees rows that belong to no company",
  });

  // ---- 3. No content writes, with a control that succeeds -----
  //
  // Two shapes, because RLS refuses them differently: an UPDATE with
  // no matching row returns zero, an INSERT that fails WITH CHECK
  // raises 42501. A probe that only tried one would call the other a
  // pass by never meeting it.
  const updateCommitment =
    `update public.commitments set description = description ` +
    `where company_id = '${A}' returning id;`;
  const paUpdate = await attempt(updateCommitment);
  const controlUpdate = await attempt(updateCommitment, fx.admin_a as string);
  const paInsert = await attempt(
    `insert into public.priorities (company_id, title, status) ` +
      `values ('${A}', 'harness probe', 'open') returning id;`
  );
  const contentOk =
    paUpdate.startsWith("0 rows") &&
    controlUpdate.includes("row(s) written") &&
    !paInsert.includes("row(s) written");
  probes.push({
    name: "portfolio write · content refused",
    granted: `control, company_admin updates the same rows: ${controlUpdate}`,
    withheld: `update commitments: ${paUpdate} | insert priority: ${paInsert}`,
    ok: contentOk,
    detail: contentOk
      ? "reads the content and cannot write it, on a table where another caller can"
      : !controlUpdate.includes("row(s) written")
        ? "NOT PROVEN: the control could not write either, so the refusal proves nothing"
        : "THE ROLE CAN WRITE CONTENT",
  });

  // ---- 4. Create a company, roots and all ---------------------
  //
  // Creating a company is only useful if the company is usable
  // afterwards, and that means chart roots and an opening quarter —
  // rows in `functions` and `quarters`, which are content tables this
  // role has no write policy on. seed_company_roots is what makes
  // both sentences true at once, so the probe asserts the seeded rows
  // rather than just the company row.
  // Three statements in one rolled-back transaction, not one CTE.
  // seed_company_roots writes rows; a data-modifying function called
  // from a CTE is not guaranteed to run, and the first version of
  // this probe reported "chart roots seeded: 0" for that reason —
  // which read as a broken grant and was a broken probe.
  const created = await numbers(`
    insert into public.companies (name, timezone)
    values ('Harness Portfolio Co', 'UTC');
    select public.seed_company_roots(
      (select id from public.companies where name = 'Harness Portfolio Co'));
    select
      (select count(*)::int from public.companies
        where name = 'Harness Portfolio Co') as company_rows,
      (select count(*)::int from public.functions where company_id =
        (select id from public.companies where name = 'Harness Portfolio Co'))
        as functions_seeded,
      (select count(*)::int from public.quarters where company_id =
        (select id from public.companies where name = 'Harness Portfolio Co'))
        as quarters_seeded;`);
  if (typeof created === "string") {
    probes.push({
      name: "portfolio write · create a company",
      granted: `create: ${created}`,
      withheld: "not reached",
      ok: false,
      detail: "THE GRANT DOES NOT WORK: the role cannot create a company",
    });
  } else {
    // All three, not just the company row. A company with no chart
    // roots cannot open its org chart, so "created a company" that
    // stops at the companies table is a grant that produces a broken
    // tenant — and it is exactly what would happen if
    // seed_company_roots refused this caller.
    const ok =
      created.company_rows === 1 &&
      created.functions_seeded === 2 &&
      created.quarters_seeded === 1;
    probes.push({
      name: "portfolio write · create a company",
      granted:
        `companies inserted: ${created.company_rows} | chart roots seeded: ` +
        `${created.functions_seeded} | opening quarter: ${created.quarters_seeded}`,
      withheld: "direct writes to functions and quarters, proved above",
      ok,
      detail: ok
        ? "creates a usable company without holding a write policy on either content table"
        : "THE GRANT DOES NOT WORK: the role cannot create a company",
    });
  }

  // ---- 5. Feature flags ---------------------------------------
  const featureOn = await attempt(
    `insert into public.company_features (company_id, feature) ` +
      `values ('${A}', '${fx.spare_feature}') returning company_id;`
  );
  const featureOff = await attempt(
    `delete from public.company_features where company_id = '${A}' ` +
      `and feature = '${fx.feature_a}' returning company_id;`
  );
  // The withheld half for this one is the entitlement HISTORY: the
  // role may read it (0190) and must not be able to edit it, or
  // "who turned this off" becomes editable by whoever turned it off.
  const historyRead = await numbers(
    `select count(*)::int as n from public.company_feature_events where company_id = '${A}';`
  );
  const historyForge = await attempt(
    `insert into public.company_feature_events (company_id, feature, action) ` +
      `values ('${A}', 'forged', 'enabled') returning id;`
  );
  const featureOk =
    featureOn.includes("row(s) written") &&
    featureOff.includes("row(s) written") &&
    typeof historyRead !== "string" &&
    historyRead.n > 0 &&
    !historyForge.includes("row(s) written");
  probes.push({
    name: "portfolio write · feature flags",
    granted:
      `enable: ${featureOn} | disable: ${featureOff} | entitlement history read: ` +
      `${typeof historyRead === "string" ? historyRead : historyRead.n} events`,
    withheld: `hand-written entitlement event: ${historyForge}`,
    ok: featureOk,
    detail: featureOk
      ? "manages packaging, reads the history of it, cannot rewrite that history"
      : "the feature grant or the entitlement-history boundary is wrong",
  });

  // ---- 6. Invite into company roles, and the ceiling ----------
  //
  // THE CEILING IS THE POINT. A role that can staff a company and
  // also mint another of itself has no ceiling at all — the first
  // portfolio_admin would be the last decision anybody made about who
  // holds the role. Both forbidden roles are tried, not one: they
  // fail through the same clause, but a clause can be edited to name
  // only one of them.
  const invite = (slot: number, role: string, company: string | null) =>
    `insert into public.profiles (id, company_id, full_name, role, status) ` +
    `values ('${INVITEE_UUIDS[slot]}', ` +
    `${company === null ? "null" : `'${company}'`}, ` +
    `'Harness Invitee ${slot}', '${role}', 'pending') returning id;`;

  const invited = await attempt(invite(0, "company_admin", A));
  const invitedMember = await attempt(invite(1, "team_member", A));
  // Both forbidden roles, each tried twice over: once with a company
  // (the policy's role clause refuses it) and the platform shape they
  // would actually want, with no company at all (the company_id
  // clause refuses that). A ceiling with one door checked is a
  // ceiling with one door.
  const mintedPortfolio = await attempt(invite(2, "portfolio_admin", A));
  const mintedSysadmin = await attempt(invite(3, "system_admin", A));
  const mintedCompanyless = await attempt(invite(2, "portfolio_admin", null));
  const inviteOk =
    invited.includes("row(s) written") &&
    invitedMember.includes("row(s) written") &&
    !mintedPortfolio.includes("row(s) written") &&
    !mintedSysadmin.includes("row(s) written") &&
    !mintedCompanyless.includes("row(s) written");
  probes.push({
    name: "portfolio write · invite, and the ceiling",
    granted: `company_admin: ${invited} | team_member: ${invitedMember}`,
    withheld:
      `portfolio_admin in a company: ${mintedPortfolio} | system_admin: ` +
      `${mintedSysadmin} | portfolio_admin with no company: ${mintedCompanyless}`,
    ok: inviteOk,
    detail: inviteOk
      ? "staffs a company and cannot mint a platform role"
      : !invited.includes("row(s) written")
        ? "THE GRANT DOES NOT WORK: the role cannot invite a company admin"
        : "ESCALATION: the role can mint a platform role",
  });

  // ---- 7. Archive yes, delete no ------------------------------
  //
  // Three refusals against one grant, because "cannot delete" has
  // three doors: the DELETE statement, the soft-delete column, and
  // the settings columns that are not on the allowlist. The column
  // guard answers the last two by raising; RLS answers the first with
  // a zero.
  const archived = await attempt(
    `update public.companies set status = 'archived' where id = '${A}' returning id;`
  );
  const softDeleted = await attempt(
    `update public.companies set deleted_at = now() where id = '${A}' returning id;`
  );
  const hardDeleted = await attempt(
    `delete from public.companies where id = '${A}' returning id;`
  );
  const settingsOk = await attempt(
    `update public.companies set timezone = 'UTC', industry = 'Harness' ` +
      `where id = '${A}' returning id;`
  );
  const archiveOk =
    archived.includes("row(s) written") &&
    settingsOk.includes("row(s) written") &&
    softDeleted === "refused by the column guard" &&
    hardDeleted.startsWith("0 rows");
  probes.push({
    name: "portfolio write · archive yes, delete no",
    granted: `archive: ${archived} | settings: ${settingsOk}`,
    withheld: `set deleted_at: ${softDeleted} | DELETE: ${hardDeleted}`,
    ok: archiveOk,
    detail: archiveOk
      ? "archives and edits settings; cannot soft-delete and cannot delete"
      : !archived.includes("row(s) written")
        ? "THE GRANT DOES NOT WORK: the role cannot archive"
        : "THE ROLE CAN REMOVE A COMPANY",
  });

  // ---- 8. The accountability layer ----------------------------
  //
  // The table that stands in for the grant table this role does not
  // have. It has to be writable by the actor (the action layer writes
  // it), unforgeable against anybody else, and invisible to the
  // subject — a log whose subject can enumerate it is a log whose
  // subject knows what was recorded.
  // NO `returning id`, and that omission is a finding rather than a
  // style choice. Postgres applies the SELECT policy to an INSERT's
  // RETURNING clause, and this table has no SELECT policy for this
  // role — by design. So `insert ... returning` is refused with the
  // same 42501 a WITH CHECK violation gives, and the first version of
  // this probe read that as "the actor cannot write its own event".
  // The row lands; it is the reading back that does not.
  //
  // The app is unaffected: recordPortfolioEvent calls .insert()
  // without .select(), which sends no RETURNING.
  //
  // So the write is made as the caller and counted afterwards as
  // postgres, in the same transaction, which rolls back with it.
  const audit = await numbers(`
    insert into public.portfolio_admin_events (actor_id, action, company_id)
    values ('${PA_UUID}', 'scoped_in', '${A}');
    select count(*)::int as own_read from public.portfolio_admin_events;
    set local role postgres;
    select
      (select count(*)::int from public.portfolio_admin_events
        where actor_id = '${PA_UUID}') as landed,
      (select count(*)::int from public.portfolio_admin_events
        where actor_id = '${PA_UUID}' and action = 'scoped_in') as landed_scoped;`);
  // The read-back as the caller, measured on its own so the count
  // above cannot be confused with it.
  const readOwn = await numbers(
    "select count(*)::int as n from public.portfolio_admin_events;"
  );
  const forgedEvent = await attempt(
    `insert into public.portfolio_admin_events (actor_id, action, company_id) ` +
      `values ('${fx.sysadmin}', 'scoped_in', '${A}');`
  );
  const landed = typeof audit === "string" ? -1 : audit.landed;
  const ownEvent = landed === 1 ? "1 row(s) written" : `landed: ${landed}`;
  const auditOk =
    landed === 1 &&
    !forgedEvent.includes("row(s) written") &&
    forgedEvent !== "0 rows (refused by RLS)" &&
    typeof readOwn !== "string" &&
    readOwn.n === 0;
  probes.push({
    name: "portfolio audit · write own, read none",
    granted: `own scope-in event: ${ownEvent}`,
    withheld:
      `event naming somebody else: ${forgedEvent} | own events read back: ` +
      `${typeof readOwn === "string" ? readOwn : readOwn.n}`,
    ok: auditOk,
    detail: auditOk
      ? "records itself, cannot record anybody else, and cannot read the record"
      : !ownEvent.includes("row(s) written")
        ? "THE AUDIT LAYER DOES NOT WORK: the actor cannot write its own event"
        : "the audit layer is forgeable or readable by its subject",
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

  // Where the clone stands, on every invocation.
  const localMigrations = readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort();
  let cloneHead: string | null = null;
  try {
    const [row] = await run<{ head: string | null }>(
      "select max(version) as head from supabase_migrations.schema_migrations;"
    );
    cloneHead = row?.head ?? null;
  } catch {
    // No migration history at all. migrate:dev refuses to push to a
    // database in that state, so say so and let it.
    cloneHead = null;
  }
  const pendingVersions = pending ? pending.split(",") : [];
  const lag = cloneLag({ cloneHead, localMigrations, pending: pendingVersions });
  console.log(
    `  Clone at ${cloneHead ?? "no migration history"}, repo at ${lag.newest ?? "none"}` +
      (lag.behind.length > 0 ? ` — BEHIND by ${lag.behind.length}` : " — current") +
      (pendingVersions.length > 0
        ? ` (${pendingVersions.length} applied per-transaction by --pending)`
        : "")
  );

  const ids = await loadIdentities(run);
  const cases = [
    ["hazard-1", hazard1],
    ["hazard-2", hazard2],
    ["hazard-3", hazard3],
    ["coach-history-reads", coachHistoryReads],
    ["coach-memory-about-mode", coachMemoryAboutMode],
    // Threaded `pendingSql` because this one probes a migration that
    // has not landed yet, and a case that silently reports "not
    // applicable" under --pending would be a probe that never ran
    // while looking like one that passed.
    [
      "coach-memory-directed",
      (r: Runner, i: Identities) => coachMemoryDirected(r, i, pendingSql),
    ],
    [
      "coach-memory-edit",
      (r: Runner, i: Identities) => coachMemoryEdit(r, i, pendingSql),
    ],
    [
      "portfolio-assignment-boundary",
      (r: Runner, i: Identities) => portfolioAssignmentBoundary(r, i, pendingSql),
    ],
    [
      "guide-assignment-revocation",
      (r: Runner, i: Identities) => guideAssignmentRevocation(r, i, pendingSql),
    ],
    [
      "assigned-access-read",
      (r: Runner, i: Identities) => assignedAccessRead(r, i, pendingSql),
    ],
    [
      "company-sort-order",
      (r: Runner, i: Identities) => companySortOrder(r, i, pendingSql),
    ],
    [
      "profiles-select-assigned",
      (r: Runner, i: Identities) => profilesSelectAssigned(r, i, pendingSql),
    ],
    [
      "portfolio-assignment-company-access",
      (r: Runner, i: Identities) =>
        portfolioAssignmentCompanyAccess(r, i, pendingSql),
    ],
    [
      "promote-steve-and-sean",
      (r: Runner, i: Identities) => promoteStevenAndSean(r, i, pendingSql),
    ],
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
  const portfolioResult = await portfolioAllowlistCheck(run, pendingSql);
  const memoryResult = await coachMemoryWallCheck(run, pendingSql);
  console.log(
    batchSummaryLines(
      [staticResult, portfolioResult, memoryResult],
      "Static checks over live policy text"
    ).join("\n")
  );

  // Grant probes run on every invocation for the same reason the
  // static check does: a guard you have to remember to ask for is not
  // a guard. See E5 in docs/failure-modes.md.
  if (pending) {
    console.log(`  Grant probes measured with supabase/migrations/${pending} applied`);
    console.log("  inside each transaction and rolled back with it.");
  }
  const probes = await grantProbes(run, ids, pendingSql);
  const portfolio = await portfolioProbes(run, ids, pendingSql);
  console.log(grantSummaryLines([...probes, ...portfolio]).join("\n"));

  let batchOk = true;
  if (batch && lag.behind.length > 0) {
    fail(
      `The clone is behind by ${lag.behind.length} migration(s): ` +
        `${lag.behind.slice(0, 5).join(", ")}${lag.behind.length > 5 ? ", …" : ""}.\n\n` +
        "  A batch report measured here would be a before/after pair taken\n" +
        "  against policies that are not the ones in production. It might\n" +
        "  still be right - batches touch disjoint tables - but it would be\n" +
        "  right by accident, and it would read exactly like a report that\n" +
        "  is wrong.\n\n" +
        "  Catch the clone up first: npm run migrate:dev\n" +
        "  (deploy ritual step 8, docs/deployment.md)"
    );
  }
  if (batch) {
    const b = findBatch(batch) as Batch;

    // A batch that creates tables has a lifespan. Its whole method is
    // to apply its migration inside a transaction and measure the
    // before/after pair; once the migration has landed for real, that
    // application raises 42710 (policy already exists) and the batch
    // reports a stack trace instead of a verdict.
    //
    // That is not a failure, it is the batch being spent. Say so, and
    // point at what carries the claim forward — for coach_memories
    // that is the permanent access-wall check, which runs on every
    // invocation against whatever schema is actually deployed and is
    // the reason a batch is allowed to expire at all.
    if ((b.newTables ?? []).length > 0) {
      const [landed] = await run<{ present: boolean }>(
        `select count(*) > 0 as present from pg_tables
          where schemaname = 'public'
            and tablename in (${(b.newTables ?? [])
              .map((t) => `'${t}'`)
              .join(", ")});`
      );
      if (landed?.present) {
        console.log(
          `\n  Batch ${b.n} is SPENT: ${(b.newTables ?? []).join(", ")} already ` +
            `exists on this database.\n` +
            `  Its before/after pair needed a schema without the table, and there\n` +
            `  is no longer one. The acceptance evidence it produced is in the PR\n` +
            `  that landed supabase/migrations/${b.migration}.\n\n` +
            `  What carries the claim forward is the permanent check above, which\n` +
            `  runs on every invocation against the deployed schema. Re-run without\n` +
            `  --batch to see it.\n`
        );
        return;
      }
    }

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
