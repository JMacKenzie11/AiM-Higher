-- =============================================================
-- Migration 0222: a function's Lead writes role descriptions
--
-- The Role Description Creator is for the person who runs a seat,
-- and the person who runs a seat is usually not a company admin.
-- Before this they could not save what the agent wrote: the insert
-- policies admit system_admin, the company's own company_admin, and
-- an assigned guide, and nobody else.
--
-- ---- WHAT MOVES ------------------------------------------------
--
-- A branch on the insert and update paths of both tables: the caller
-- leads SOME non-archived function in the company the document
-- belongs to.
--
-- Same shape as 0217, which let a Lead author their function's
-- critical success factors. `(select auth.uid())` rather than a bare
-- call, so it is hoisted and runs once per statement.
--
-- ---- ANY DOCUMENT, NOT JUST THEIR OWN SEAT'S -------------------
--
-- This first said a Lead may write the document for the function
-- they lead and no other, which is the narrower reading and the one
-- a permissions change usually deserves. It was widened before it
-- reached any database, deliberately and on the product's call:
-- heading up a function is the threshold for writing role
-- descriptions here, not a claim over one row.
--
-- The consequence is worth stating plainly rather than discovering:
-- a function head can edit the role description of the seat above
-- them, including the Visionary's. Everyone who can do that could
-- already see every document in the company, and a version is never
-- overwritten — so the worst case is an edit somebody disagrees
-- with, visible in the history with their name on it, not a loss.
--
-- It also means an OFF-CHART role is writable by a Lead, which the
-- narrow version could not express: those have no function and
-- therefore no lead of their own.
--
-- ---- WHAT DOES NOT MOVE ---------------------------------------
--
-- DELETE. A lead writes documents and cannot remove their history,
-- which matches versions being immutable for everyone.
--
-- SELECT. It has always admitted any member of the company.
--
-- The chart itself. Leading a function has never carried the right
-- to rename one, and nothing here changes that; the harness asserts
-- it in the same case that asserts the widening.
-- =============================================================

-- True when the caller heads up any live function in this company.
-- A function with no lead, or an archived one, admits nobody.
create or replace function public.leads_a_function_in(target_company_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.functions f
    where f.company_id = target_company_id
      and f.archived = false
      and f.lead_id = auth.uid()
  )
$$;

revoke all on function public.leads_a_function_in(uuid) from public;
grant execute on function public.leads_a_function_in(uuid) to authenticated;

comment on function public.leads_a_function_in(uuid) is
  'True for anyone who is the lead of at least one non-archived '
  'function in this company. The write threshold for role '
  'descriptions since 0222.';

-- ---- role_descriptions ---------------------------------------

drop policy if exists role_descriptions_insert_lead on public.role_descriptions;
create policy role_descriptions_insert_lead on public.role_descriptions
for insert to authenticated
with check (
  public.leads_a_function_in(public.role_descriptions.company_id)
);

-- The title follows the document: a newer version may name the seat
-- differently and the save keeps the row current. Without this a
-- lead's second save fails on a row they are otherwise allowed to
-- extend.
drop policy if exists role_descriptions_update_lead on public.role_descriptions;
create policy role_descriptions_update_lead on public.role_descriptions
for update to authenticated
using (public.leads_a_function_in(public.role_descriptions.company_id))
with check (public.leads_a_function_in(public.role_descriptions.company_id));

-- ---- role_description_versions -------------------------------
--
-- The parent check from 0221 is carried forward verbatim: company_id
-- alone would let a caller attach a version to another company's
-- role, which reads back denied and leaves the history corrupt.

drop policy if exists role_description_versions_insert_lead
  on public.role_description_versions;
create policy role_description_versions_insert_lead
  on public.role_description_versions
for insert to authenticated
with check (
  public.leads_a_function_in(public.role_description_versions.company_id)
  and exists (
    select 1 from public.role_descriptions rd
    where rd.id = public.role_description_versions.role_id
      and rd.company_id = public.role_description_versions.company_id
  )
);
