-- =============================================================
-- Migration 0192: what a portfolio_admin may write.
--
-- A CLOSED LIST OF THREE, and the word closed is doing work. This is
-- not "administrative writes, roughly"; it is these and nothing else,
-- and a static check in scripts/rls-harness.ts fails the build if the
-- role's name turns up in a write policy on any other table.
--
--   1. create a company
--   2. manage a company's settings and feature flags
--   3. invite users into company-scoped roles
--
-- Plus one explicit subtraction: ARCHIVE YES, DELETE NO.
-- deleteCompanyAction stays system_admin only, and the column guard
-- below makes `deleted_at` unreachable for this role even if the
-- action were widened by mistake.
--
-- THE ROLE CANNOT WRITE CONTENT. Not one policy in this file, and not
-- one policy anywhere, admits portfolio_admin to a commitment, a
-- priority, a measure, a meeting or a foundation item. The read
-- surface in 0191 is sixty policies wide; the write surface is this
-- file, and the asymmetry is the design.
-- =============================================================

-- ---- 1. Create a company -------------------------------------
--
-- Permissive, beside companies_insert rather than replacing it.

drop policy if exists companies_insert_portfolio on public.companies;
create policy companies_insert_portfolio on public.companies
for insert to authenticated
with check ((select public.is_portfolio_admin()));

-- SEEDING A NEW COMPANY'S ROOTS WITHOUT A CONTENT GRANT.
--
-- createCompany() does not only insert a company row. It seeds the
-- chart roots (Visionary, Integrator) and an opening quarter, because
-- a company without them cannot open its org chart or take an action.
-- Those are writes to `functions` and `quarters`, which are content
-- tables, and giving this role an INSERT policy on them to make
-- company creation work would be exactly the hole the closed list
-- exists to prevent: a content grant, justified by an administrative
-- need, that then sits there for every other purpose too.
--
-- So the seeding moves below the policy boundary. This function runs
-- as its owner, checks for itself who is calling, and is the only way
-- those rows get made. The caller needs no rights on functions or
-- quarters at all — they need the right to have created the company,
-- which is already decided by the time this runs.
--
-- WHY IT IS SAFE TO BE SECURITY DEFINER. It takes a company id and
-- nothing else; it cannot be steered at another table, another
-- column, or another company's existing rows. It refuses outright
-- unless the caller is a system_admin, a portfolio_admin, or a
-- service-role caller (provisioning and the seed scripts, for whom
-- auth_role() is NULL). And it refuses a company that already has
-- functions, so it cannot be called twice to double-seed or called at
-- all against an established tenant.

create or replace function public.seed_company_roots(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
  visionary_id uuid;
  q_start date;
  q_end date;
  q_label text;
begin
  caller_role := (select public.auth_role());

  -- NULL is the service role: provisioning, the seed scripts, a
  -- migration. Spelled as an explicit branch rather than left to fall
  -- through a comparison, because `NULL not in (...)` is NULL, not
  -- true, and a guard that evaluates to NULL admits nobody and
  -- nothing - including provisioning. Hazard 2.
  if caller_role is not null
     and caller_role <> 'system_admin'
     and caller_role <> 'portfolio_admin' then
    raise exception
      'seed_company_roots is not available to %', caller_role
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.companies c where c.id = p_company_id) then
    raise exception 'No such company %', p_company_id
      using errcode = 'foreign_key_violation';
  end if;

  -- Already seeded. Returning quietly rather than raising: the caller
  -- asked for roots to exist and they do.
  if exists (select 1 from public.functions f where f.company_id = p_company_id) then
    return;
  end if;

  insert into public.functions
    (company_id, parent_function_id, title, description, sort_order)
  values (
    p_company_id, null, 'Visionary',
    'Owner/founder - sets direction, culture, and the long-term bet.', 0
  )
  returning id into visionary_id;

  insert into public.functions
    (company_id, parent_function_id, title, description, sort_order)
  values (
    p_company_id, visionary_id, 'Integrator',
    'COO - turns the vision into execution across the leadership team.', 0
  );

  -- The calendar quarter containing today, computed here rather than
  -- passed in, so the database is not trusting a caller to say what
  -- quarter it is.
  -- Two intervals, not the single string '3 months - 1 day'.
  -- Postgres accepts that string, which is the problem: whether the
  -- minus binds to the day is not obvious from reading it, and the
  -- difference between right and wrong here is one day at a quarter
  -- boundary, which is the kind of wrong nobody notices for months.
  q_start := date_trunc('quarter', current_date)::date;
  q_end := (date_trunc('quarter', current_date)
            + interval '3 months' - interval '1 day')::date;
  -- Matches calendarQuarterOf in src/lib/quarters/calendar.ts exactly
  -- ("Q3 2026"). A company seeded here and a company seeded there must
  -- not label the same quarter two ways.
  q_label := 'Q' || to_char(current_date, 'Q') || ' ' || to_char(current_date, 'YYYY');

  insert into public.quarters
    (company_id, label, start_date, end_date, status)
  values (p_company_id, q_label, q_start, q_end, 'open');
end;
$$;

revoke all on function public.seed_company_roots(uuid) from public;
grant execute on function public.seed_company_roots(uuid) to authenticated;

comment on function public.seed_company_roots(uuid) is
  'Seeds a new company chart roots and opening quarter. SECURITY '
  'DEFINER so company creation does not require the caller to hold '
  'INSERT on functions or quarters - which is what keeps '
  'portfolio_admin out of every content write policy. Refuses any '
  'caller that is not system_admin, portfolio_admin, or the service '
  'role, and refuses a company that already has functions.';

-- ---- 2. Settings and feature flags ---------------------------

drop policy if exists companies_update_portfolio on public.companies;
create policy companies_update_portfolio on public.companies
for update to authenticated
using ((select public.is_portfolio_admin()))
with check ((select public.is_portfolio_admin()));

-- The column guard, extended. 0176 established it for company_admin
-- and aims_guide, whose granted set is one column and whose protected
-- set is everything else - so that branch is written as a DENYLIST,
-- and a column added to companies tomorrow is protected from them the
-- day it is added.
--
-- portfolio_admin is the other way round. Their granted set is four
-- named columns and is meant to stay that way, so their branch is an
-- ALLOWLIST, which has the same property from the other side: a
-- column added tomorrow is DENIED to them until somebody decides
-- otherwise. Both branches fail closed on a schema change; they just
-- start from different ends.
--
-- `deleted_at` is the one that matters. It is not in the allowlist,
-- so a portfolio_admin cannot soft-delete a company even if
-- deleteCompanyAction were widened to admit them by mistake. Archive
-- is `status`, which they do have.

create or replace function public.companies_restrict_admin_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
begin
  caller_role := (select public.auth_role());

  -- The container role: four named columns, everything else refused.
  if caller_role is not distinct from 'portfolio_admin' then
    if (to_jsonb(new) - 'name' - 'timezone' - 'industry' - 'status' - 'updated_at')
       is distinct from
       (to_jsonb(old) - 'name' - 'timezone' - 'industry' - 'status' - 'updated_at') then
      raise exception
        'A portfolio_admin may change only name, timezone, industry and status on a company (attempted on company %)',
        old.id
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  -- 0176, unchanged in behaviour: industry and nothing else.
  if caller_role is distinct from 'company_admin'
     and caller_role is distinct from 'aims_guide' then
    return new;
  end if;

  if (to_jsonb(new) - 'industry' - 'updated_at')
     is distinct from (to_jsonb(old) - 'industry' - 'updated_at') then
    raise exception
      'Only industry may be changed on a company by a % (attempted on company %)',
      caller_role, old.id
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

-- Feature flags. Insert and delete only, matching how entitlements
-- are actually changed: setCompanyFeaturesAction adds rows and
-- removes them, and never updates one in place. No UPDATE policy, so
-- the pair of writes the app makes is the whole surface.
--
-- The 0173 trigger writes company_feature_events for both, so a
-- portfolio_admin toggling a feature leaves the same record a
-- system_admin does, without this migration doing anything to make
-- that happen.

drop policy if exists company_features_insert_portfolio on public.company_features;
create policy company_features_insert_portfolio on public.company_features
for insert to authenticated
with check ((select public.is_portfolio_admin()));

drop policy if exists company_features_delete_portfolio on public.company_features;
create policy company_features_delete_portfolio on public.company_features
for delete to authenticated
using ((select public.is_portfolio_admin()));

-- ---- 3. Invite users into company-scoped roles ---------------
--
-- INSERT only. Editing an existing user is not on the closed list, so
-- there is no UPDATE policy and no DELETE policy here: a
-- portfolio_admin can staff a company and cannot then rewrite or
-- remove the people in it.
--
-- THE ROLE CEILING IS IN THE POLICY, not only in the dropdown and not
-- only in the action. `role in ('company_admin','team_member')` is
-- the same clause profiles_insert_guide carries, and it is what makes
-- "a portfolio_admin can never create another portfolio_admin or a
-- system_admin" a property of the database rather than a property of
-- the code that happens to call it today.
--
-- `company_id is not null` is the second half of the same sentence: a
-- profile with no company IS a platform role, so admitting a null
-- here would re-open the ceiling from the other side.

drop policy if exists profiles_insert_portfolio on public.profiles;
create policy profiles_insert_portfolio on public.profiles
for insert to authenticated
with check (
  (select public.is_portfolio_admin())
  and company_id is not null
  and role in ('company_admin', 'team_member')
);
