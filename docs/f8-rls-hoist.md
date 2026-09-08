# F8: hoisting the RLS helpers

The plan for rewriting the row-level-security policies so
`auth_profile()` is evaluated once per statement instead of once per
row.

This is a multi-PR project on the tenant-isolation boundary. It is
written down because it will span sessions, and because the order of
the steps is the safety property: the tests that catch a wrong hoist
have to exist, and be proven capable of catching one, before any real
policy is touched.

Background and the felt-cost evidence are F8 and the F11 addendum in
`performance-review.md`.

---

## Why

The policies read

```sql
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.company_id is not null and ap.company_id = public.<table>.company_id)
  )
)
```

The `or` against a constant blocks the planner's hashed-semijoin
transformation, so this becomes a per-row `SubPlan`. Measured on the
dev clone, 5000 rows, one caller: **`auth_profile` loops=5000**.

In a real query it compounds. `/plan`'s `sfa_progress` read, as an
ordinary company member, ran six `auth_profile()` subplans with loop
counts 3, 38, 48, 138, 141 and 270 — **638 executions to return three
rows** — and 35.1 ms of the 36.4 ms total. The people paying that are
clients, not staff: the same query costs a `system_admin` 16.7 ms,
because their predicate short-circuits on the first branch.

## The shape, decided by measurement

Four candidate forms, same policy shape, 5000 rows, one caller,
`npm run rls:hazards -- --explain`:

| form | InitPlan | `auth_profile` loops | time |
|---|---|---|---|
| A `exists (select 1 from auth_profile() …)` — today | no | **5000** | 2.486 ms |
| B `(select ap.col from auth_profile() ap limit 1) = …` | yes | **1** | 1.542 ms |
| C `auth_company_id() = …` — bare wrapper function | no | not in plan | **930.188 ms** |
| D `(select auth_company_id()) = …` — wrapper in a subquery | **yes** | not in plan | **1.485 ms** |

**The shape is D.** The bare wrapper (C) — the intuitive reading of
"scalar-returning by construction" — is **374× slower than the status
quo**. A `security definer` SQL function containing `limit` is not
inlinable, so it is called per row with full function-call overhead and
without even the `SubPlan` machinery the `exists` form gets. It is the
worst of the four by two orders of magnitude, and nothing in the policy
text would tell you.

D is both things at once: the scalar subquery is what earns the
`InitPlan`, and the wrapper is what makes hazard 3 impossible, because
a function declared `returns uuid` cannot return two rows. Neither half
is optional.

This is also the pattern already in the schema. Migration 0164 wrote
`status = (select public.auth_profile_status())` for exactly this
reason, and it is the only hoisted policy in the codebase today.

So the project adds:

```sql
create or replace function public.auth_company_id() returns uuid
  language sql stable security definer set search_path = public
  as $$ select company_id from public.auth_profile() limit 1 $$;

create or replace function public.auth_role() returns text
  language sql stable security definer set search_path = public
  as $$ select role from public.auth_profile() limit 1 $$;
```

and policies are rewritten to `(select public.auth_role())` and
`(select public.auth_company_id())`. **Always wrapped in `(select …)`.**
A bare call is form C.

## Scope

From the live catalog, not from migration text — the two disagree
because policies are dropped and recreated:

| | count |
|---|---|
| policies in `public` | 314 |
| using `auth_profile()` | 179 |
| using `is_guide_for()` | 120 |
| carrying a `company_id IS NOT NULL` guard | **65** |

`is_guide_for(company_id)` takes a per-row argument and cannot be
hoisted. It is out of scope. It is already cheap — a two-column
primary-key probe — and it is only reached when the preceding branch
is false.

The 65 with a `company_id IS NOT NULL` guard are the hazard-1 surface
and get the extra test named below.

---

## The three hazards

Each is demonstrated, not asserted, by `npm run rls:hazards`. Each case
installs the wrong shape and the right shape side by side and asserts
that **the wrong one leaks and the right one denies** — a case that
reports both green is a broken case, and the harness says so.

### Hazard 1 — `IS NOT DISTINCT FROM` turns deny into allow

`ap.company_id is not null and ap.company_id = row.company_id` is
guarded: a caller with no company matches nothing. Hoisted to
`= row.company_id` it still denies (NULL). Hoisted to
`is not distinct from` — the idiom 0164 established — **NULL matches
NULL**.

Live, not theoretical: `meetings.company_id` is nullable and unrouted
meetings are a designed product state. Every `system_admin` and every
`aims_guide` has a NULL `company_id`. Nullable `company_id` columns
today: `meetings`, `profiles`, `coach_token_usage`,
`strengths_assessments`, `transcript_sources`,
`transcript_source_audit_log`.

**Test.** Given a profile with `company_id IS NULL` and a row with
`company_id IS NULL`, the caller sees zero rows. The clone currently
has no unrouted meetings, so the case **creates** the condition rather
than looking for it.

### Hazard 2 — NULL is not false once the expression is composed

With no profile row `auth_profile()` returns zero rows, so `exists` is
`false` and the scalar form is `NULL`. A bare `using (NULL)` denies, so
the simple case is safe and the danger is composition: `coalesce(…,
true)`, a negation, or a NULL branch beside a non-NULL one in an `or`.
Several policies here already `or` three clauses together.

**Test.** Given a JWT `sub` matching no `profiles` row — a deleted
user's still-valid token — the caller sees zero rows from **every table
in the batch**, with no error. Asserted per table, not in aggregate.

### Hazard 3 — a scalar subquery over a set-returning helper raises

`auth_profile()` is set-returning. A scalar subquery over it returns
one row only because `profiles` has a primary key. If that function's
`WHERE` ever changes, the `exists` form degrades to `false` while the
scalar form raises `more than one row returned by a subquery used as an
expression` — turning a denial into a 500 on every protected read,
fleet-wide, at once.

Form D removes the hazard by construction: `auth_company_id()` is
declared `returns uuid` and cannot return two rows whatever happens
inside it.

**Test.** Given a helper redefined to return two rows, the failure is a
denial, not an exception.

---

## The static check

`IS NOT DISTINCT FROM` is **forbidden in tenant-scoping policies**.
Enforced, not remembered: a check over live policy text that fails on
`IS NOT DISTINCT FROM` anywhere outside an explicit allowlist. The
allowlist contains exactly one entry today —
`profiles.profiles_update_self` — with a comment saying why it is
legitimately there: it is a self-update where both sides are
legitimately NULL for a `system_admin`, not a tenant comparison.

0164 is a loaded precedent. Someone looking for house style will find
it, and the check is what disarms it.

---

## Order of work

**1. The harness.** `scripts/rls-harness.ts`, invoked by name, output
pasted into the PR body like the browser passes. Not CI: it needs
`SUPABASE_MANAGEMENT_TOKEN` and points at a shared clone that anyone
may refresh, and a gate a colleague's refresh can redden is a gate that
gets deleted. Its first contents are the three hazard cases, red-green
proven against deliberately wrong hoists **before any policy changes**.

**2. Batches.** Expand-and-contract across the fleet per the deploy
ritual in `docs/deployment.md`, in table groups sized so each PR's
EXPLAIN story is readable. Suggested grouping, smallest blast radius
first:

| batch | tables |
|---|---|
| 1 | `companies`, `company_features`, `quarters` |
| 2 | `commitments`, `commitment_occurrences` |
| 3 | `strategic_focus_areas`, `annual_goals`, `priorities` |
| 4 | `functions`, `success_measures`, `success_measure_entries`, `csf_kpi_links` |
| 5 | `meetings`, `meeting_analyses`, `transcript_*` — the nullable-`company_id` group |
| 6 | `coaching_*`, `issues`, `notifications`, everything remaining |

Per batch, in the PR body:

- **Per-caller-class EXPLAIN, before and after**: `postgres`,
  `system_admin`, company member. The same three run for F11.
- **The deleted-user test against every table in the batch**, zero rows
  each.
- **The nullable-`company_id` test per table** for any table in the
  batch that has one.
- **Isolation acceptance**: a member of company A cannot read company
  B, asserted through the harness with real JWTs. **Per batch, not once
  at the end.**

**3. The static check** ships with batch 1, so no later batch can
introduce the forbidden idiom.

## What would make this stop

Any batch where the after-EXPLAIN does not show `InitPlan` and
`loops=1`, or where the isolation acceptance does not deny. Stop, do
not promote, and do not start the next batch. A half-hoisted policy set
is not a state to reason about later — every batch is a complete
expand-and-contract on its own tables.
