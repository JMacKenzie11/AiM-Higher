-- =============================================================
-- Migration 0222: a function's Lead writes its role description
--
-- The Role Description Creator is for the person who runs a seat,
-- and the person who runs a seat is usually not a company admin.
-- Today they cannot save what the agent writes: the insert policies
-- on role_descriptions and role_description_versions admit
-- system_admin, the company's own company_admin, and an assigned
-- guide, and nobody else.
--
-- ---- WHAT MOVES ------------------------------------------------
--
-- One branch, on the insert and update paths of both tables:
-- `lead_id = (select auth.uid())` on the function the document is
-- FOR, beside the branches already there.
--
-- Same shape as 0217, which let a Lead author their function's
-- critical success factors, and for the same reason: the person who
-- knows what the seat is held to is not the person who could write
-- it down. `(select auth.uid())` rather than a bare call, so it is
-- hoisted and runs once per statement.
--
-- ---- WHAT DOES NOT -------------------------------------------
--
-- A LEAD WRITES THEIR OWN FUNCTION AND NOTHING ELSE. Not another
-- function's, and not an off-chart role. A document for a seat with
-- no function on the chart has no lead by construction, so there is
-- nobody for this branch to admit; those stay admin-and-guide, which
-- is what they were.
--
-- This is the narrow reading of "available to anyone who heads up a
-- function" and it is a deliberate choice: the alternative admits
-- any lead to any seat's document, including the one above them.
-- Widening later is one predicate; narrowing after a fleet has used
-- it is not.
--
-- DELETE is untouched. A lead can write their seat's description and
-- cannot remove its history, which matches versions being immutable
-- for everyone.
--
-- SELECT is untouched. It has always admitted any member of the
-- company, leads included.
-- =============================================================

-- ---- role_descriptions ---------------------------------------

drop policy if exists role_descriptions_insert_lead on public.role_descriptions;
create policy role_descriptions_insert_lead on public.role_descriptions
for insert to authenticated
with check (
  exists (
    select 1
    from public.functions f
    where f.id = public.role_descriptions.function_id
      and f.company_id = public.role_descriptions.company_id
      and f.archived = false
      and f.lead_id = (select auth.uid())
  )
);

-- The title follows the document, and the save action refreshes it
-- when a newer version names the seat differently. Without this a
-- lead's second save fails on a row they created themselves.
drop policy if exists role_descriptions_update_lead on public.role_descriptions;
create policy role_descriptions_update_lead on public.role_descriptions
for update to authenticated
using (
  exists (
    select 1
    from public.functions f
    where f.id = public.role_descriptions.function_id
      and f.company_id = public.role_descriptions.company_id
      and f.archived = false
      and f.lead_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.functions f
    where f.id = public.role_descriptions.function_id
      and f.company_id = public.role_descriptions.company_id
      and f.archived = false
      and f.lead_id = (select auth.uid())
  )
);

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
  exists (
    select 1
    from public.functions f
    where f.id = public.role_description_versions.function_id
      and f.company_id = public.role_description_versions.company_id
      and f.archived = false
      and f.lead_id = (select auth.uid())
  )
  and exists (
    select 1 from public.role_descriptions rd
    where rd.id = public.role_description_versions.role_id
      and rd.company_id = public.role_description_versions.company_id
  )
);
