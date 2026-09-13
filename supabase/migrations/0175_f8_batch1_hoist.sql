-- =============================================================
-- Migration 0175 — F8 batch 1: hoist the RLS helpers on
-- companies, company_features, quarters.
--
-- The plan, the measurements behind the shape, and the three
-- hazards are docs/f8-rls-hoist.md. The short version:
--
-- Today's policies read
--
--   exists (select 1 from public.auth_profile() ap
--            where ap.role = 'system_admin'
--               or (ap.company_id is not null and ap.company_id = t.company_id))
--
-- The OR against a constant blocks the planner's hashed-semijoin
-- transformation, so the helper is evaluated once PER ROW: measured
-- at auth_profile loops=5000 on 5000 rows, and at loops=141 and
-- loops=270 inside real /plan reads in production. Company members
-- pay it; a system_admin does not, because their first branch
-- short-circuits.
--
-- THE SHAPE IS `(select public.auth_role())`, never a bare
-- `public.auth_role()`. Measured, four forms, same policy shape,
-- 5000 rows (npm run rls:hazards -- --explain):
--
--   A  exists (...)                  InitPlan=no   loops=5000     2.783 ms
--   B  inline scalar subquery        InitPlan=yes  loops=1        1.360 ms
--   C  bare wrapper function         InitPlan=no   not in plan  954.621 ms
--   D  wrapper in a scalar subquery  InitPlan=yes  not in plan    1.507 ms
--
-- C is the intuitive reading of "scalar-returning by construction"
-- and it is 374x SLOWER than the status quo: a security definer SQL
-- function containing `limit` is not inlinable, so it is called per
-- row with full function-call overhead and without even the SubPlan
-- machinery the exists form gets. Nothing in the policy text would
-- tell you. Every call below is wrapped in `(select ...)`.
--
-- WHY THE WRAPPER AND NOT PLAIN FORM B. auth_profile() is
-- set-returning, and a scalar subquery over it returns one row only
-- because profiles has a primary key. If that function's WHERE ever
-- changes, form B degrades from a denial into `more than one row
-- returned by a subquery used as an expression` — a 500 on every
-- protected read, fleet-wide, at once. auth_role() is declared
-- `returns text` and auth_company_id() `returns uuid`, so neither
-- can return two rows whatever happens inside them. Hazard 3 in the
-- harness demonstrates both halves.
--
-- IS NOT DISTINCT FROM IS NOT USED HERE, deliberately. It is the
-- idiom 0164 established for profiles_update_self, where both sides
-- are legitimately NULL for a system_admin, and it is a privilege
-- hole anywhere a caller's company is compared to a row's: NULL
-- matches NULL, so a caller with no company reads every unrouted
-- row. `=` yields NULL and denies. The harness enforces this over
-- live policy text, allowlisting exactly that one policy.
--
-- SEMANTICS ARE UNCHANGED. Every predicate below is the current one
-- transcribed from pg_policies, with `ap.role` becoming
-- `(select public.auth_role())` and `ap.company_id` becoming
-- `(select public.auth_company_id())`. The `is not null` guards are
-- kept exactly where they are today even though `=` already denies
-- on NULL: this migration changes how the helper is evaluated, not
-- who is admitted, and a reader comparing the two texts should find
-- nothing else to check.
--
-- A caller with no profile row at all — a deleted user holding a
-- still-valid JWT — gets NULL from both helpers rather than the
-- `false` the exists form produced. Bare NULL in USING denies, and
-- nothing here composes it with coalesce, a negation, or a NULL
-- branch beside a non-NULL one. That is hazard 2, and it is asserted
-- per table rather than reasoned about: see the batch acceptance in
-- scripts/rls-harness.ts.
--
-- The _guide mirrors are untouched. is_guide_for(company_id) takes a
-- per-row argument and cannot be hoisted; it is a two-column
-- primary-key probe and is only reached when the branch before it is
-- false.
--
-- Expand-safe: policy bodies only. No table, column or grant
-- changes, and no running code observes a policy definition.
-- =============================================================

-- ---- The two helpers ----------------------------------------
--
-- Both are thin scalar projections of auth_profile(), which stays
-- exactly as it is. They exist to make the scalar subquery form
-- cardinality-safe by declaration; the `limit 1` is belt to that
-- braces.

create or replace function public.auth_role()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role from public.auth_profile() limit 1
$$;

revoke all on function public.auth_role() from public;
grant execute on function public.auth_role() to authenticated;

create or replace function public.auth_company_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select company_id from public.auth_profile() limit 1
$$;

revoke all on function public.auth_company_id() from public;
grant execute on function public.auth_company_id() to authenticated;

-- ---- companies ----------------------------------------------
--
-- companies_hide_deleted (RESTRICTIVE, `deleted_at is null`) and
-- companies_select_guide (is_guide_for) are not touched.
--
-- Note companies_select compares against companies.id, not a
-- company_id column, and carries no `is not null` guard today.
-- companies.id is NOT NULL, so there is no NULL-to-NULL pair to
-- create and none is introduced.

drop policy if exists companies_select on public.companies;
create policy companies_select on public.companies
for select to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (select public.auth_company_id()) = public.companies.id
);

drop policy if exists companies_insert on public.companies;
create policy companies_insert on public.companies
for insert to authenticated
with check ((select public.auth_role()) = 'system_admin');

drop policy if exists companies_update on public.companies;
create policy companies_update on public.companies
for update to authenticated
using ((select public.auth_role()) = 'system_admin')
with check ((select public.auth_role()) = 'system_admin');

drop policy if exists companies_delete on public.companies;
create policy companies_delete on public.companies
for delete to authenticated
using ((select public.auth_role()) = 'system_admin');

-- ---- company_features ---------------------------------------
--
-- Reads are the company's own members plus system_admin; writes are
-- system_admin only. Unchanged here.

drop policy if exists company_features_select on public.company_features;
create policy company_features_select on public.company_features
for select to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_company_id()) is not null
    and (select public.auth_company_id()) = public.company_features.company_id
  )
);

drop policy if exists company_features_insert on public.company_features;
create policy company_features_insert on public.company_features
for insert to authenticated
with check ((select public.auth_role()) = 'system_admin');

drop policy if exists company_features_update on public.company_features;
create policy company_features_update on public.company_features
for update to authenticated
using ((select public.auth_role()) = 'system_admin')
with check ((select public.auth_role()) = 'system_admin');

drop policy if exists company_features_delete on public.company_features;
create policy company_features_delete on public.company_features
for delete to authenticated
using ((select public.auth_role()) = 'system_admin');

-- ---- quarters -----------------------------------------------
--
-- Writes admit company_admin on their own company; the aims_guide
-- mirrors (quarters_*_guide) carry the same grant through
-- is_guide_for and are untouched.

drop policy if exists quarters_select on public.quarters;
create policy quarters_select on public.quarters
for select to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_company_id()) is not null
    and (select public.auth_company_id()) = public.quarters.company_id
  )
);

drop policy if exists quarters_insert on public.quarters;
create policy quarters_insert on public.quarters
for insert to authenticated
with check (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) is not null
    and (select public.auth_company_id()) = public.quarters.company_id
  )
);

drop policy if exists quarters_update on public.quarters;
create policy quarters_update on public.quarters
for update to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) is not null
    and (select public.auth_company_id()) = public.quarters.company_id
  )
)
with check (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) is not null
    and (select public.auth_company_id()) = public.quarters.company_id
  )
);

drop policy if exists quarters_delete on public.quarters;
create policy quarters_delete on public.quarters
for delete to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) is not null
    and (select public.auth_company_id()) = public.quarters.company_id
  )
);
