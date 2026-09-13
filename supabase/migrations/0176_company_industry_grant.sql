-- =============================================================
-- Migration 0176: make the industry grant real.
--
-- setCompanyIndustryAction (src/lib/companies/actions.ts:136) admits
-- system_admin, company_admin and aims_guide, and has since commit
-- 5f43059, "Company admins: open Industry, Transcripts,
-- Planning-cycle actions". That commit changed four TypeScript files
-- and no migration. companies_update has admitted system_admin and
-- nobody else since 0004_rls.sql:56.
--
-- So the field renders for a company admin, they type into it, and
-- the save returns "Couldn't update the industry." every time —
-- .select("*").single() comes back empty because RLS refused the
-- write. Demonstrated rather than deduced: as a company_admin the
-- UPDATE returned 0 rows while the same statement as a system_admin
-- returned 1.
--
-- The decision is to fix the grant rather than withdraw it. This
-- migration widens the policy to match the action.
--
-- WHY A TRIGGER AND NOT JUST A POLICY. The grant is for ONE COLUMN,
-- and a policy cannot express that. RLS decides which ROWS a
-- statement may touch; it has no column dimension, and WITH CHECK
-- cannot compare the new row against the old one — USING sees OLD,
-- WITH CHECK sees NEW, and never both. A policy alone that let a
-- company admin update their own row would let them update `status`
-- and `deleted_at` on it too, which is how a tenant archives or
-- soft-deletes themselves.
--
-- Column-level GRANTs are the other obvious tool and do not work
-- here: privileges attach to the Postgres role, and every signed-in
-- user of this app is `authenticated`. Restricting that role to
-- `update (industry)` would take `status` away from system_admin at
-- the same time.
--
-- So: two permissive policies admit the rows, and a BEFORE UPDATE
-- trigger constrains the columns for exactly the roles the policies
-- newly admit. system_admin and service-role writes are untouched by
-- both halves.
--
-- THE COLUMN GUARD IS A DENYLIST BY CONSTRUCTION, not a list of
-- column names. It compares the two rows as jsonb with `industry`
-- and `updated_at` removed, so a column added to this table in the
-- future is protected the day it is added rather than the day
-- somebody remembers to add it here. `is distinct from` is the
-- null-safe comparison and is correct here for the same reason it is
-- wrong in a tenant predicate: both sides are values of the same
-- row, not a caller compared to a tenant.
--
-- Policies are form D per docs/f8-rls-hoist.md — `(select
-- public.auth_role())`, never a bare call. This migration depends on
-- 0175 for those helpers.
-- =============================================================

-- ---- The column guard ---------------------------------------
--
-- Fires for every UPDATE and returns immediately unless the caller
-- is one of the two roles 0176 newly admits. auth_role() is NULL for
-- a service-role write (provisioning, seeds, the soft-delete in
-- deleteCompanyAction), and NULL is not in the list, so those pass
-- through as they always have.

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

  if caller_role is distinct from 'company_admin'
     and caller_role is distinct from 'aims_guide' then
    return new;
  end if;

  -- Everything except the granted column and the timestamp the
  -- companies_set_updated_at trigger maintains.
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

-- Name matters: BEFORE UPDATE triggers fire in alphabetical order,
-- and companies_restrict_admin_columns sorts before
-- companies_set_updated_at. The guard therefore runs on the row as
-- the caller submitted it, not after another trigger has edited it.
drop trigger if exists companies_restrict_admin_columns on public.companies;
create trigger companies_restrict_admin_columns
  before update on public.companies
  for each row execute function public.companies_restrict_admin_columns();

-- ---- The two policies ---------------------------------------
--
-- Permissive, so they OR with the existing companies_update rather
-- than narrowing it. system_admin keeps exactly the access it has.

drop policy if exists companies_update_admin on public.companies;
create policy companies_update_admin on public.companies
for update to authenticated
using (
  (select public.auth_role()) = 'company_admin'
  and (select public.auth_company_id()) is not null
  and (select public.auth_company_id()) = public.companies.id
)
with check (
  (select public.auth_role()) = 'company_admin'
  and (select public.auth_company_id()) is not null
  and (select public.auth_company_id()) = public.companies.id
);

-- The guide mirror. A policy admitting company_admin gets one, per
-- the rule in 0111: an aims_guide is a company_admin on the
-- companies assigned to them. is_guide_for takes a per-row argument
-- and is deliberately not hoisted — see docs/f8-rls-hoist.md.
drop policy if exists companies_update_guide on public.companies;
create policy companies_update_guide on public.companies
for update to authenticated
using (public.is_guide_for(public.companies.id))
with check (public.is_guide_for(public.companies.id));
