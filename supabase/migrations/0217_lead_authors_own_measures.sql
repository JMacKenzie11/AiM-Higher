-- =============================================================
-- Migration 0217: a function's Lead authors its measures
--
-- The person accountable for a function could type its weekly values
-- and could not change what was being measured. Adding a critical
-- success factor, fixing its target, correcting a name or archiving
-- a row it has outgrown all needed an admin or a guide.
--
-- That is the wrong shape for the one number a function head is held
-- to, and it is the practical reason most of these lists go stale:
-- the person who knows the measure is wrong is not the person who can
-- change it.
--
-- ---- WHAT MOVES ------------------------------------------------
--
-- One branch, on one policy. `success_measures_write_by_function`
-- gains `f.lead_id = (select auth.uid())` beside the system_admin and
-- company_admin branches it already carries.
--
-- The policy is FOR ALL, so this covers insert, update and delete in
-- one place. Archiving is an UPDATE of `archived`, so it comes with
-- the rest rather than needing a rule of its own.
--
-- ---- WHAT DOES NOT -------------------------------------------
--
-- `success_measure_entries` is untouched. Its write policy has
-- admitted the lead since 0179, which is the asymmetry this fixes:
-- a lead could write the value and not the measure.
--
-- `success_measures_write_by_function_guide` is untouched. It admits
-- guides through is_guide_for(), and a guide is not a lead; the two
-- branches are independent and neither needs the other.
--
-- `success_measure_targets` is untouched and deliberately so. It has
-- no write policy at all (0215) and rows arrive only through the
-- trigger on this table. A lead editing a target now writes history
-- exactly as an admin does, because the gate was always the UPDATE
-- that fires the trigger and that gate has just widened.
--
-- ---- THE SHAPE OF THE BRANCH ---------------------------------
--
-- `f.lead_id = (select auth.uid())` rather than a join or a helper.
-- Form D: the subquery is hoisted so auth.uid() runs once per
-- statement rather than once per row, and it matches the branch
-- already in success_measure_entries_write character for character,
-- so the two read as one rule expressed twice rather than two rules
-- that happen to agree.
--
-- NOT track_id. The entries policy carries `or f.track_id = ...` and
-- this deliberately does not: no form in the application submits
-- track_id, so every function written through the app sets it null.
-- Fleet-wide there are three rows with one, two of which differ from
-- the lead. Widening a write path on a column nothing populates would
-- be adding a door to a wall.
-- =============================================================

drop policy if exists success_measures_write_by_function on public.success_measures;
create policy success_measures_write_by_function on public.success_measures
for all to authenticated
using (
  exists (
    select 1 from public.functions f
    where f.id = public.success_measures.function_id
      and (
        (select public.auth_role()) = 'system_admin'
        or (
          (select public.auth_role()) = 'company_admin'
          and (select public.auth_company_id()) = f.company_id
        )
        or f.lead_id = (select auth.uid())
      )
  )
)
with check (
  exists (
    select 1 from public.functions f
    where f.id = public.success_measures.function_id
      and (
        (select public.auth_role()) = 'system_admin'
        or (
          (select public.auth_role()) = 'company_admin'
          and (select public.auth_company_id()) = f.company_id
        )
        or f.lead_id = (select auth.uid())
      )
  )
);

comment on policy success_measures_write_by_function on public.success_measures is
  'System admins, the company''s own admin, and the function''s Lead. The Lead branch was added in 0217: they could already write the weekly value (success_measure_entries, since 0179) and not the measure, so the person who knows a target is wrong was not the person who could change it. Guides come through the _guide mirror.';
