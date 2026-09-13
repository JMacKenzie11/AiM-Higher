-- =============================================================
-- Migration 0178: F8 batch 3 — the planning tables.
--
-- strategic_focus_areas, annual_goals, priorities. Third table group
-- in the order set by docs/f8-rls-hoist.md, and the one F11 measured
-- the per-row helper tax heaviest on.
--
-- Fifteen policies, five per table, transcribed from pg_policies on
-- production with:
--
--   ap.role        ->  (select public.auth_role())
--   ap.company_id  ->  (select public.auth_company_id())
--   auth.uid()     ->  (select auth.uid())
--
-- The twelve _guide policies are untouched: is_guide_for(company_id)
-- takes a per-row argument and cannot be hoisted.
--
-- THE OWNER POLICIES ARE THE INTERESTING ONES. On all three tables
-- the owner's USING and WITH CHECK are deliberately different:
--
--   USING       the row is mine AND it is in my company
--   WITH CHECK  the row is mine
--
-- That asymmetry is the rule "you may edit your own, and you may not
-- hand it to somebody else" — USING decides which rows you may touch,
-- WITH CHECK decides what the row may become. Transcribed exactly,
-- and probed both ways in this batch's report, because a read plan
-- cannot show it and a symmetric rewrite would silently drop it.
--
-- The owner column is sponsor_id on strategic_focus_areas and
-- owner_id on the other two. The names differ; the rule does not.
--
-- Form D throughout. No `is not null` guard is added where today has
-- none: the owner predicates rely on `=` denying against NULL, which
-- is the behaviour they already have.
-- =============================================================

-- ---- strategic_focus_areas -------------------------

drop policy if exists sfa_select on public.strategic_focus_areas;
create policy sfa_select on public.strategic_focus_areas
for select to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_company_id()) is not null
    and (select public.auth_company_id()) = public.strategic_focus_areas.company_id
  )
);

drop policy if exists sfa_insert on public.strategic_focus_areas;
create policy sfa_insert on public.strategic_focus_areas
for insert to authenticated
with check (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.strategic_focus_areas.company_id
  )
);

drop policy if exists sfa_update_admin on public.strategic_focus_areas;
create policy sfa_update_admin on public.strategic_focus_areas
for update to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.strategic_focus_areas.company_id
  )
)
with check (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.strategic_focus_areas.company_id
  )
);

-- USING and WITH CHECK differ on purpose. See the header.
drop policy if exists sfa_update_owner on public.strategic_focus_areas;
create policy sfa_update_owner on public.strategic_focus_areas
for update to authenticated
using (
  public.strategic_focus_areas.sponsor_id = (select auth.uid())
  and (select public.auth_company_id()) = public.strategic_focus_areas.company_id
)
with check (public.strategic_focus_areas.sponsor_id = (select auth.uid()));

drop policy if exists sfa_delete on public.strategic_focus_areas;
create policy sfa_delete on public.strategic_focus_areas
for delete to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.strategic_focus_areas.company_id
  )
);

-- ---- annual_goals ----------------------------------

drop policy if exists annual_goals_select on public.annual_goals;
create policy annual_goals_select on public.annual_goals
for select to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_company_id()) is not null
    and (select public.auth_company_id()) = public.annual_goals.company_id
  )
);

drop policy if exists annual_goals_insert on public.annual_goals;
create policy annual_goals_insert on public.annual_goals
for insert to authenticated
with check (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.annual_goals.company_id
  )
);

drop policy if exists annual_goals_update_admin on public.annual_goals;
create policy annual_goals_update_admin on public.annual_goals
for update to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.annual_goals.company_id
  )
)
with check (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.annual_goals.company_id
  )
);

-- USING and WITH CHECK differ on purpose. See the header.
drop policy if exists annual_goals_update_owner on public.annual_goals;
create policy annual_goals_update_owner on public.annual_goals
for update to authenticated
using (
  public.annual_goals.owner_id = (select auth.uid())
  and (select public.auth_company_id()) = public.annual_goals.company_id
)
with check (public.annual_goals.owner_id = (select auth.uid()));

drop policy if exists annual_goals_delete on public.annual_goals;
create policy annual_goals_delete on public.annual_goals
for delete to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.annual_goals.company_id
  )
);

-- ---- priorities ------------------------------------

drop policy if exists priorities_select on public.priorities;
create policy priorities_select on public.priorities
for select to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_company_id()) is not null
    and (select public.auth_company_id()) = public.priorities.company_id
  )
);

drop policy if exists priorities_insert on public.priorities;
create policy priorities_insert on public.priorities
for insert to authenticated
with check (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.priorities.company_id
  )
);

drop policy if exists priorities_update_admin on public.priorities;
create policy priorities_update_admin on public.priorities
for update to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.priorities.company_id
  )
)
with check (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.priorities.company_id
  )
);

-- USING and WITH CHECK differ on purpose. See the header.
drop policy if exists priorities_update_owner on public.priorities;
create policy priorities_update_owner on public.priorities
for update to authenticated
using (
  public.priorities.owner_id = (select auth.uid())
  and (select public.auth_company_id()) = public.priorities.company_id
)
with check (public.priorities.owner_id = (select auth.uid()));

drop policy if exists priorities_delete on public.priorities;
create policy priorities_delete on public.priorities
for delete to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.priorities.company_id
  )
);
