-- =============================================================
-- Migration 0245 — an assigned portfolio admin writes to its four
-- tables only
--
-- CLAUDE.md, Permissions: "portfolio_admin may hold a write policy only
-- on companies, company_features, profiles and portfolio_admin_events."
-- Jason, 2026-09-29: inside a company a portfolio admin writes to
-- those four and reads the rest.
--
-- The database said otherwise. Since 0199, is_guide_for() is a wrapper
-- over is_admin_for(), which admits an assigned aims_guide AND an
-- assigned portfolio_admin. 75 write rules on 30 content tables call
-- one or the other, so an assigned portfolio admin could insert,
-- change and delete plans, commitments, the chart, measures and the
-- rest. Two privileged functions let them through the same way:
-- roll_quarter (closing and opening a quarter) and
-- record_external_pull (writing a measure's value).
--
-- rls:hazards did not catch it: its static check fails a write rule
-- that NAMES portfolio_admin, and these reach the role through a
-- function. The harness's portfolio case asserted the reach as
-- intended. Both are corrected in the same PR (scripts/rls-harness.ts).
--
-- ---- WHAT CHANGES --------------------------------------------------
--
-- In each of the 75 rules, and in the two functions, is_guide_for()
-- and is_admin_for() become is_assigned_guide_for() (0221): an
-- assigned aims_guide, and nobody else. Every other clause is kept
-- word for word, so company admins, system admins, owners and members
-- keep exactly what they had. Written out rule by rule from the
-- production schema (identical on production, PromiseOne and the dev
-- clone, 2026-09-29), so the file says what the database will hold.
--
-- READS DO NOT CHANGE. Select rules are not touched. Three of the 75
-- are FOR ALL, which covers reads too; each gets a FOR SELECT twin
-- carrying its original expression, so an assigned portfolio admin
-- still reads what it read before.
--
-- The four tables keep their portfolio rules: companies,
-- company_features, profiles, portfolio_admin_events (and
-- portfolio_assignments, the container itself), none of which is
-- touched here.
--
-- ---- BEFORE THIS RAN (read only, 2026-09-29) -------------------------
--
-- production: 1 portfolio admin, 0 assigned. PromiseOne: 3, all
-- assigned. dev clone: 1, 0 assigned. On every instance, no row in the
-- 30 tables records a portfolio admin as its author (created_by,
-- generated_by, entered_by, resolved_by_profile_id). 24 of the 30
-- tables have no author column, so there a write cannot be ruled out,
-- only not seen. On PromiseOne, portfolio admins OWN 14 commitments
-- and 3 priorities (owner_id): assigned to them, which says nothing
-- about who wrote them.
-- =============================================================


-- ---- annual_goals ----
-- annual_goals_delete_guide (DELETE) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "annual_goals_delete_guide" on public."annual_goals"
  using (public.is_assigned_guide_for(company_id));
comment on policy "annual_goals_delete_guide" on public."annual_goals" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';
-- annual_goals_insert_guide (INSERT) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "annual_goals_insert_guide" on public."annual_goals"
  with check (public.is_assigned_guide_for(company_id));
comment on policy "annual_goals_insert_guide" on public."annual_goals" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';
-- annual_goals_update_guide (UPDATE) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "annual_goals_update_guide" on public."annual_goals"
  using (public.is_assigned_guide_for(company_id))
  with check (public.is_assigned_guide_for(company_id));
comment on policy "annual_goals_update_guide" on public."annual_goals" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';

-- ---- commitment_occurrences ----
-- commitment_occurrences_write_admin (ALL) admits: system_admin, company_admin, an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "commitment_occurrences_write_admin" on public."commitment_occurrences"
  using ((EXISTS ( SELECT 1
   FROM commitments c
  WHERE ((c.id = commitment_occurrences.commitment_id) AND ((( SELECT auth_role() AS auth_role) = 'system_admin'::text) OR ((( SELECT auth_role() AS auth_role) = 'company_admin'::text) AND (( SELECT auth_company_id() AS auth_company_id) = c.company_id)) OR public.is_assigned_guide_for(c.company_id))))))
  with check ((EXISTS ( SELECT 1
   FROM commitments c
  WHERE ((c.id = commitment_occurrences.commitment_id) AND ((( SELECT auth_role() AS auth_role) = 'system_admin'::text) OR ((( SELECT auth_role() AS auth_role) = 'company_admin'::text) AND (( SELECT auth_company_id() AS auth_company_id) = c.company_id)) OR public.is_assigned_guide_for(c.company_id))))));
comment on policy "commitment_occurrences_write_admin" on public."commitment_occurrences" is
  'Admits: system_admin, company_admin, an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';
-- The FOR SELECT twin: reads as before, portfolio admins included.
drop policy if exists "commitment_occurrences_write_admin_read" on public."commitment_occurrences";
create policy "commitment_occurrences_write_admin_read" on public."commitment_occurrences"
  for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM commitments c
  WHERE ((c.id = commitment_occurrences.commitment_id) AND ((( SELECT auth_role() AS auth_role) = 'system_admin'::text) OR ((( SELECT auth_role() AS auth_role) = 'company_admin'::text) AND (( SELECT auth_company_id() AS auth_company_id) = c.company_id)) OR is_guide_for(c.company_id))))));

-- ---- commitments ----
-- commitments_delete_guide (DELETE) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "commitments_delete_guide" on public."commitments"
  using (public.is_assigned_guide_for(company_id));
comment on policy "commitments_delete_guide" on public."commitments" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';
-- commitments_insert_guide (INSERT) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "commitments_insert_guide" on public."commitments"
  with check (public.is_assigned_guide_for(company_id));
comment on policy "commitments_insert_guide" on public."commitments" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';
-- commitments_update_guide (UPDATE) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "commitments_update_guide" on public."commitments"
  using (public.is_assigned_guide_for(company_id))
  with check (public.is_assigned_guide_for(company_id));
comment on policy "commitments_update_guide" on public."commitments" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';

-- ---- company_foundation ----
-- company_foundation_delete_guide (DELETE) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "company_foundation_delete_guide" on public."company_foundation"
  using (public.is_assigned_guide_for(company_id));
comment on policy "company_foundation_delete_guide" on public."company_foundation" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';
-- company_foundation_insert_guide (INSERT) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "company_foundation_insert_guide" on public."company_foundation"
  with check (public.is_assigned_guide_for(company_id));
comment on policy "company_foundation_insert_guide" on public."company_foundation" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';
-- company_foundation_update_guide (UPDATE) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "company_foundation_update_guide" on public."company_foundation"
  using (public.is_assigned_guide_for(company_id))
  with check (public.is_assigned_guide_for(company_id));
comment on policy "company_foundation_update_guide" on public."company_foundation" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';

-- ---- dashboard_ai_briefs ----
-- dashboard_ai_briefs_insert_guide (INSERT) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "dashboard_ai_briefs_insert_guide" on public."dashboard_ai_briefs"
  with check (public.is_assigned_guide_for(company_id));
comment on policy "dashboard_ai_briefs_insert_guide" on public."dashboard_ai_briefs" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';

-- ---- external_pull_log ----
-- external_pull_log_insert (INSERT) admits: system_admin, company_admin, an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "external_pull_log_insert" on public."external_pull_log"
  with check (((( SELECT auth_role() AS auth_role) = 'system_admin'::text) OR ((( SELECT auth_role() AS auth_role) = 'company_admin'::text) AND (( SELECT auth_company_id() AS auth_company_id) IS NOT NULL) AND (( SELECT auth_company_id() AS auth_company_id) = company_id)) OR public.is_assigned_guide_for(company_id)));
comment on policy "external_pull_log_insert" on public."external_pull_log" is
  'Admits: system_admin, company_admin, an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';

-- ---- foundation_items ----
-- foundation_items_delete_guide (DELETE) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "foundation_items_delete_guide" on public."foundation_items"
  using (public.is_assigned_guide_for(company_id));
comment on policy "foundation_items_delete_guide" on public."foundation_items" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';
-- foundation_items_insert_guide (INSERT) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "foundation_items_insert_guide" on public."foundation_items"
  with check (public.is_assigned_guide_for(company_id));
comment on policy "foundation_items_insert_guide" on public."foundation_items" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';
-- foundation_items_update_guide (UPDATE) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "foundation_items_update_guide" on public."foundation_items"
  using (public.is_assigned_guide_for(company_id))
  with check (public.is_assigned_guide_for(company_id));
comment on policy "foundation_items_update_guide" on public."foundation_items" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';

-- ---- function_competencies ----
-- function_competencies_delete_guide (DELETE) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "function_competencies_delete_guide" on public."function_competencies"
  using (public.is_assigned_guide_for(( SELECT functions.company_id
   FROM functions
  WHERE (functions.id = function_competencies.function_id))));
comment on policy "function_competencies_delete_guide" on public."function_competencies" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';
-- function_competencies_insert_guide (INSERT) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "function_competencies_insert_guide" on public."function_competencies"
  with check (public.is_assigned_guide_for(( SELECT functions.company_id
   FROM functions
  WHERE (functions.id = function_competencies.function_id))));
comment on policy "function_competencies_insert_guide" on public."function_competencies" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';
-- function_competencies_update_guide (UPDATE) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "function_competencies_update_guide" on public."function_competencies"
  using (public.is_assigned_guide_for(( SELECT functions.company_id
   FROM functions
  WHERE (functions.id = function_competencies.function_id))))
  with check (public.is_assigned_guide_for(( SELECT functions.company_id
   FROM functions
  WHERE (functions.id = function_competencies.function_id))));
comment on policy "function_competencies_update_guide" on public."function_competencies" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';

-- ---- function_decision_rights ----
-- function_decision_rights_delete_guide (DELETE) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "function_decision_rights_delete_guide" on public."function_decision_rights"
  using (public.is_assigned_guide_for(( SELECT functions.company_id
   FROM functions
  WHERE (functions.id = function_decision_rights.function_id))));
comment on policy "function_decision_rights_delete_guide" on public."function_decision_rights" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';
-- function_decision_rights_insert_guide (INSERT) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "function_decision_rights_insert_guide" on public."function_decision_rights"
  with check (public.is_assigned_guide_for(( SELECT functions.company_id
   FROM functions
  WHERE (functions.id = function_decision_rights.function_id))));
comment on policy "function_decision_rights_insert_guide" on public."function_decision_rights" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';
-- function_decision_rights_update_guide (UPDATE) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "function_decision_rights_update_guide" on public."function_decision_rights"
  using (public.is_assigned_guide_for(( SELECT functions.company_id
   FROM functions
  WHERE (functions.id = function_decision_rights.function_id))))
  with check (public.is_assigned_guide_for(( SELECT functions.company_id
   FROM functions
  WHERE (functions.id = function_decision_rights.function_id))));
comment on policy "function_decision_rights_update_guide" on public."function_decision_rights" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';

-- ---- function_roles ----
-- function_roles_delete_guide (DELETE) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "function_roles_delete_guide" on public."function_roles"
  using (((is_default = false) AND (EXISTS ( SELECT 1
   FROM functions f
  WHERE ((f.id = function_roles.function_id) AND public.is_assigned_guide_for(f.company_id))))));
comment on policy "function_roles_delete_guide" on public."function_roles" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';
-- function_roles_insert_guide (INSERT) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "function_roles_insert_guide" on public."function_roles"
  with check ((EXISTS ( SELECT 1
   FROM functions f
  WHERE ((f.id = function_roles.function_id) AND public.is_assigned_guide_for(f.company_id)))));
comment on policy "function_roles_insert_guide" on public."function_roles" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';
-- function_roles_update_guide (UPDATE) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "function_roles_update_guide" on public."function_roles"
  using (((is_default = false) AND (EXISTS ( SELECT 1
   FROM functions f
  WHERE ((f.id = function_roles.function_id) AND public.is_assigned_guide_for(f.company_id))))))
  with check (((is_default = false) AND (EXISTS ( SELECT 1
   FROM functions f
  WHERE ((f.id = function_roles.function_id) AND public.is_assigned_guide_for(f.company_id))))));
comment on policy "function_roles_update_guide" on public."function_roles" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';

-- ---- functional_areas ----
-- functional_areas_delete_guide (DELETE) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "functional_areas_delete_guide" on public."functional_areas"
  using (public.is_assigned_guide_for(company_id));
comment on policy "functional_areas_delete_guide" on public."functional_areas" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';
-- functional_areas_insert_guide (INSERT) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "functional_areas_insert_guide" on public."functional_areas"
  with check (public.is_assigned_guide_for(company_id));
comment on policy "functional_areas_insert_guide" on public."functional_areas" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';
-- functional_areas_update_guide (UPDATE) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "functional_areas_update_guide" on public."functional_areas"
  using (public.is_assigned_guide_for(company_id))
  with check (public.is_assigned_guide_for(company_id));
comment on policy "functional_areas_update_guide" on public."functional_areas" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';

-- ---- functions ----
-- functions_delete_guide (DELETE) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "functions_delete_guide" on public."functions"
  using (public.is_assigned_guide_for(company_id));
comment on policy "functions_delete_guide" on public."functions" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';
-- functions_insert_guide (INSERT) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "functions_insert_guide" on public."functions"
  with check (public.is_assigned_guide_for(company_id));
comment on policy "functions_insert_guide" on public."functions" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';
-- functions_update_guide (UPDATE) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "functions_update_guide" on public."functions"
  using (public.is_assigned_guide_for(company_id))
  with check (public.is_assigned_guide_for(company_id));
comment on policy "functions_update_guide" on public."functions" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';

-- ---- issues ----
-- issues_insert_admin (INSERT) admits: system_admin, company_admin, an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "issues_insert_admin" on public."issues"
  with check (((( SELECT auth_role() AS auth_role) = 'system_admin'::text) OR ((( SELECT auth_role() AS auth_role) = 'company_admin'::text) AND (( SELECT auth_company_id() AS auth_company_id) = company_id)) OR public.is_assigned_guide_for(company_id)));
comment on policy "issues_insert_admin" on public."issues" is
  'Admits: system_admin, company_admin, an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';
-- issues_update_guide (UPDATE) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "issues_update_guide" on public."issues"
  using (public.is_assigned_guide_for(company_id))
  with check (public.is_assigned_guide_for(company_id));
comment on policy "issues_update_guide" on public."issues" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';

-- ---- marketing_snippets ----
-- marketing_snippets_delete_guide (DELETE) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "marketing_snippets_delete_guide" on public."marketing_snippets"
  using (public.is_assigned_guide_for(company_id));
comment on policy "marketing_snippets_delete_guide" on public."marketing_snippets" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';
-- marketing_snippets_insert_guide (INSERT) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "marketing_snippets_insert_guide" on public."marketing_snippets"
  with check (public.is_assigned_guide_for(company_id));
comment on policy "marketing_snippets_insert_guide" on public."marketing_snippets" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';
-- marketing_snippets_update_guide (UPDATE) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "marketing_snippets_update_guide" on public."marketing_snippets"
  using (public.is_assigned_guide_for(company_id))
  with check (public.is_assigned_guide_for(company_id));
comment on policy "marketing_snippets_update_guide" on public."marketing_snippets" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';

-- ---- marketing_strategy ----
-- marketing_strategy_delete_guide (DELETE) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "marketing_strategy_delete_guide" on public."marketing_strategy"
  using (public.is_assigned_guide_for(company_id));
comment on policy "marketing_strategy_delete_guide" on public."marketing_strategy" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';
-- marketing_strategy_insert_guide (INSERT) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "marketing_strategy_insert_guide" on public."marketing_strategy"
  with check (public.is_assigned_guide_for(company_id));
comment on policy "marketing_strategy_insert_guide" on public."marketing_strategy" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';
-- marketing_strategy_update_guide (UPDATE) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "marketing_strategy_update_guide" on public."marketing_strategy"
  using (public.is_assigned_guide_for(company_id))
  with check (public.is_assigned_guide_for(company_id));
comment on policy "marketing_strategy_update_guide" on public."marketing_strategy" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';

-- ---- meetings ----
-- meetings_update_guide (UPDATE) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "meetings_update_guide" on public."meetings"
  using (((company_id IS NOT NULL) AND public.is_assigned_guide_for(company_id)))
  with check (((company_id IS NOT NULL) AND public.is_assigned_guide_for(company_id)));
comment on policy "meetings_update_guide" on public."meetings" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';

-- ---- messaging_pillars ----
-- messaging_pillars_delete_guide (DELETE) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "messaging_pillars_delete_guide" on public."messaging_pillars"
  using (public.is_assigned_guide_for(company_id));
comment on policy "messaging_pillars_delete_guide" on public."messaging_pillars" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';
-- messaging_pillars_insert_guide (INSERT) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "messaging_pillars_insert_guide" on public."messaging_pillars"
  with check (public.is_assigned_guide_for(company_id));
comment on policy "messaging_pillars_insert_guide" on public."messaging_pillars" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';
-- messaging_pillars_update_guide (UPDATE) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "messaging_pillars_update_guide" on public."messaging_pillars"
  using (public.is_assigned_guide_for(company_id))
  with check (public.is_assigned_guide_for(company_id));
comment on policy "messaging_pillars_update_guide" on public."messaging_pillars" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';

-- ---- priorities ----
-- priorities_delete_guide (DELETE) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "priorities_delete_guide" on public."priorities"
  using (public.is_assigned_guide_for(company_id));
comment on policy "priorities_delete_guide" on public."priorities" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';
-- priorities_insert_guide (INSERT) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "priorities_insert_guide" on public."priorities"
  with check (public.is_assigned_guide_for(company_id));
comment on policy "priorities_insert_guide" on public."priorities" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';
-- priorities_update_guide (UPDATE) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "priorities_update_guide" on public."priorities"
  using (public.is_assigned_guide_for(company_id))
  with check (public.is_assigned_guide_for(company_id));
comment on policy "priorities_update_guide" on public."priorities" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';

-- ---- quarters ----
-- quarters_delete_guide (DELETE) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "quarters_delete_guide" on public."quarters"
  using (public.is_assigned_guide_for(company_id));
comment on policy "quarters_delete_guide" on public."quarters" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';
-- quarters_insert_guide (INSERT) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "quarters_insert_guide" on public."quarters"
  with check (public.is_assigned_guide_for(company_id));
comment on policy "quarters_insert_guide" on public."quarters" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';
-- quarters_update_guide (UPDATE) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "quarters_update_guide" on public."quarters"
  using (public.is_assigned_guide_for(company_id))
  with check (public.is_assigned_guide_for(company_id));
comment on policy "quarters_update_guide" on public."quarters" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';

-- ---- role_description_documents ----
-- role_description_documents_delete_guide (DELETE) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "role_description_documents_delete_guide" on public."role_description_documents"
  using (public.is_assigned_guide_for(( SELECT functions.company_id
   FROM functions
  WHERE (functions.id = role_description_documents.function_id))));
comment on policy "role_description_documents_delete_guide" on public."role_description_documents" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';
-- role_description_documents_insert_guide (INSERT) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "role_description_documents_insert_guide" on public."role_description_documents"
  with check (public.is_assigned_guide_for(( SELECT functions.company_id
   FROM functions
  WHERE (functions.id = role_description_documents.function_id))));
comment on policy "role_description_documents_insert_guide" on public."role_description_documents" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';
-- role_description_documents_update_guide (UPDATE) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "role_description_documents_update_guide" on public."role_description_documents"
  using (public.is_assigned_guide_for(( SELECT functions.company_id
   FROM functions
  WHERE (functions.id = role_description_documents.function_id))))
  with check (public.is_assigned_guide_for(( SELECT functions.company_id
   FROM functions
  WHERE (functions.id = role_description_documents.function_id))));
comment on policy "role_description_documents_update_guide" on public."role_description_documents" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';

-- ---- scorecard_entries ----
-- scorecard_entries_delete_guide (DELETE) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "scorecard_entries_delete_guide" on public."scorecard_entries"
  using ((EXISTS ( SELECT 1
   FROM scorecard_metrics m
  WHERE ((m.id = scorecard_entries.metric_id) AND public.is_assigned_guide_for(m.company_id)))));
comment on policy "scorecard_entries_delete_guide" on public."scorecard_entries" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';
-- scorecard_entries_insert_guide (INSERT) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "scorecard_entries_insert_guide" on public."scorecard_entries"
  with check ((EXISTS ( SELECT 1
   FROM scorecard_metrics m
  WHERE ((m.id = scorecard_entries.metric_id) AND public.is_assigned_guide_for(m.company_id)))));
comment on policy "scorecard_entries_insert_guide" on public."scorecard_entries" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';
-- scorecard_entries_update_guide (UPDATE) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "scorecard_entries_update_guide" on public."scorecard_entries"
  using ((EXISTS ( SELECT 1
   FROM scorecard_metrics m
  WHERE ((m.id = scorecard_entries.metric_id) AND public.is_assigned_guide_for(m.company_id)))))
  with check ((EXISTS ( SELECT 1
   FROM scorecard_metrics m
  WHERE ((m.id = scorecard_entries.metric_id) AND public.is_assigned_guide_for(m.company_id)))));
comment on policy "scorecard_entries_update_guide" on public."scorecard_entries" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';

-- ---- scorecard_metrics ----
-- scorecard_metrics_delete_guide (DELETE) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "scorecard_metrics_delete_guide" on public."scorecard_metrics"
  using (public.is_assigned_guide_for(company_id));
comment on policy "scorecard_metrics_delete_guide" on public."scorecard_metrics" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';
-- scorecard_metrics_insert_guide (INSERT) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "scorecard_metrics_insert_guide" on public."scorecard_metrics"
  with check (public.is_assigned_guide_for(company_id));
comment on policy "scorecard_metrics_insert_guide" on public."scorecard_metrics" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';
-- scorecard_metrics_update_guide (UPDATE) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "scorecard_metrics_update_guide" on public."scorecard_metrics"
  using (public.is_assigned_guide_for(company_id))
  with check (public.is_assigned_guide_for(company_id));
comment on policy "scorecard_metrics_update_guide" on public."scorecard_metrics" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';

-- ---- session_briefs ----
-- session_briefs_insert (INSERT) admits: system_admin, an assigned aims_guide, the person the row belongs to. Was also: an assigned portfolio_admin.
alter policy "session_briefs_insert" on public."session_briefs"
  with check (((generated_by = ( SELECT auth.uid() AS uid)) AND ((( SELECT auth_role() AS auth_role) = 'system_admin'::text) OR public.is_assigned_guide_for(company_id))));
comment on policy "session_briefs_insert" on public."session_briefs" is
  'Admits: system_admin, an assigned aims_guide, the person the row belongs to (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';

-- ---- strategic_focus_areas ----
-- strategic_focus_areas_delete_guide (DELETE) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "strategic_focus_areas_delete_guide" on public."strategic_focus_areas"
  using (public.is_assigned_guide_for(company_id));
comment on policy "strategic_focus_areas_delete_guide" on public."strategic_focus_areas" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';
-- strategic_focus_areas_insert_guide (INSERT) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "strategic_focus_areas_insert_guide" on public."strategic_focus_areas"
  with check (public.is_assigned_guide_for(company_id));
comment on policy "strategic_focus_areas_insert_guide" on public."strategic_focus_areas" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';
-- strategic_focus_areas_update_guide (UPDATE) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "strategic_focus_areas_update_guide" on public."strategic_focus_areas"
  using (public.is_assigned_guide_for(company_id))
  with check (public.is_assigned_guide_for(company_id));
comment on policy "strategic_focus_areas_update_guide" on public."strategic_focus_areas" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';

-- ---- strengths_team_members ----
-- strengths_team_members_delete_guide (DELETE) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "strengths_team_members_delete_guide" on public."strengths_team_members"
  using ((EXISTS ( SELECT 1
   FROM strengths_teams t
  WHERE ((t.id = strengths_team_members.team_id) AND public.is_assigned_guide_for(t.company_id)))));
comment on policy "strengths_team_members_delete_guide" on public."strengths_team_members" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';
-- strengths_team_members_insert_guide (INSERT) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "strengths_team_members_insert_guide" on public."strengths_team_members"
  with check ((EXISTS ( SELECT 1
   FROM strengths_teams t
  WHERE ((t.id = strengths_team_members.team_id) AND public.is_assigned_guide_for(t.company_id)))));
comment on policy "strengths_team_members_insert_guide" on public."strengths_team_members" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';
-- strengths_team_members_update_guide (UPDATE) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "strengths_team_members_update_guide" on public."strengths_team_members"
  using ((EXISTS ( SELECT 1
   FROM strengths_teams t
  WHERE ((t.id = strengths_team_members.team_id) AND public.is_assigned_guide_for(t.company_id)))))
  with check ((EXISTS ( SELECT 1
   FROM strengths_teams t
  WHERE ((t.id = strengths_team_members.team_id) AND public.is_assigned_guide_for(t.company_id)))));
comment on policy "strengths_team_members_update_guide" on public."strengths_team_members" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';

-- ---- strengths_teams ----
-- strengths_teams_delete_guide (DELETE) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "strengths_teams_delete_guide" on public."strengths_teams"
  using (public.is_assigned_guide_for(company_id));
comment on policy "strengths_teams_delete_guide" on public."strengths_teams" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';
-- strengths_teams_insert_guide (INSERT) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "strengths_teams_insert_guide" on public."strengths_teams"
  with check ((company_has_feature(company_id, 'strengths'::text) AND public.is_assigned_guide_for(company_id)));
comment on policy "strengths_teams_insert_guide" on public."strengths_teams" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';
-- strengths_teams_update_guide (UPDATE) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "strengths_teams_update_guide" on public."strengths_teams"
  using (public.is_assigned_guide_for(company_id))
  with check (public.is_assigned_guide_for(company_id));
comment on policy "strengths_teams_update_guide" on public."strengths_teams" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';

-- ---- success_measure_entries ----
-- success_measure_entries_write_guide (ALL) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "success_measure_entries_write_guide" on public."success_measure_entries"
  using ((EXISTS ( SELECT 1
   FROM (success_measures sm
     JOIN functions f ON ((f.id = sm.function_id)))
  WHERE ((sm.id = success_measure_entries.measure_id) AND public.is_assigned_guide_for(f.company_id)))))
  with check ((EXISTS ( SELECT 1
   FROM (success_measures sm
     JOIN functions f ON ((f.id = sm.function_id)))
  WHERE ((sm.id = success_measure_entries.measure_id) AND public.is_assigned_guide_for(f.company_id)))));
comment on policy "success_measure_entries_write_guide" on public."success_measure_entries" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';
-- The FOR SELECT twin: reads as before, portfolio admins included.
drop policy if exists "success_measure_entries_write_guide_read" on public."success_measure_entries";
create policy "success_measure_entries_write_guide_read" on public."success_measure_entries"
  for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM (success_measures sm
     JOIN functions f ON ((f.id = sm.function_id)))
  WHERE ((sm.id = success_measure_entries.measure_id) AND is_guide_for(f.company_id)))));

-- ---- success_measures ----
-- success_measures_write_by_function_guide (ALL) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "success_measures_write_by_function_guide" on public."success_measures"
  using ((EXISTS ( SELECT 1
   FROM functions f
  WHERE ((f.id = success_measures.function_id) AND public.is_assigned_guide_for(f.company_id)))))
  with check ((EXISTS ( SELECT 1
   FROM functions f
  WHERE ((f.id = success_measures.function_id) AND public.is_assigned_guide_for(f.company_id)))));
comment on policy "success_measures_write_by_function_guide" on public."success_measures" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';
-- The FOR SELECT twin: reads as before, portfolio admins included.
drop policy if exists "success_measures_write_by_function_guide_read" on public."success_measures";
create policy "success_measures_write_by_function_guide_read" on public."success_measures"
  for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM functions f
  WHERE ((f.id = success_measures.function_id) AND is_guide_for(f.company_id)))));

-- ---- transcript_aliases ----
-- transcript_aliases_delete_guide (DELETE) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "transcript_aliases_delete_guide" on public."transcript_aliases"
  using (public.is_assigned_guide_for(company_id));
comment on policy "transcript_aliases_delete_guide" on public."transcript_aliases" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';
-- transcript_aliases_insert_guide (INSERT) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "transcript_aliases_insert_guide" on public."transcript_aliases"
  with check (public.is_assigned_guide_for(company_id));
comment on policy "transcript_aliases_insert_guide" on public."transcript_aliases" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';
-- transcript_aliases_update_guide (UPDATE) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "transcript_aliases_update_guide" on public."transcript_aliases"
  using (public.is_assigned_guide_for(company_id))
  with check (public.is_assigned_guide_for(company_id));
comment on policy "transcript_aliases_update_guide" on public."transcript_aliases" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';

-- ---- transcript_sources ----
-- transcript_sources_delete_guide (DELETE) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "transcript_sources_delete_guide" on public."transcript_sources"
  using (((company_id IS NOT NULL) AND public.is_assigned_guide_for(company_id)));
comment on policy "transcript_sources_delete_guide" on public."transcript_sources" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';
-- transcript_sources_insert_guide (INSERT) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "transcript_sources_insert_guide" on public."transcript_sources"
  with check (((company_id IS NOT NULL) AND public.is_assigned_guide_for(company_id)));
comment on policy "transcript_sources_insert_guide" on public."transcript_sources" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';
-- transcript_sources_update_guide (UPDATE) admits: an assigned aims_guide. Was also: an assigned portfolio_admin.
alter policy "transcript_sources_update_guide" on public."transcript_sources"
  using (((company_id IS NOT NULL) AND public.is_assigned_guide_for(company_id)))
  with check (((company_id IS NOT NULL) AND public.is_assigned_guide_for(company_id)));
comment on policy "transcript_sources_update_guide" on public."transcript_sources" is
  'Admits: an assigned aims_guide (0245). Never an assigned portfolio_admin: is_assigned_guide_for, not is_guide_for.';

-- ---- the two functions ----
-- roll_quarter: admits system_admin, the company's own company_admin, an assigned aims_guide.
CREATE OR REPLACE FUNCTION public.roll_quarter(p_company_id uuid, p_label text, p_start_date date, p_end_date date)
 RETURNS TABLE(closed_quarter uuid, opened_quarter uuid, moved integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_old uuid;
  v_new uuid;
  v_moved integer := 0;
begin
  if v_uid is null then
    raise exception 'roll_quarter requires an authenticated caller';
  end if;

  -- The same set the quarter actions admit: system_admin, the
  -- company's own admin, or an assigned guide (0245: never an
  -- assigned portfolio admin, whose writes stay on its four tables).
  if not (
    public.auth_role() = 'system_admin'
    or (
      public.auth_role() = 'company_admin'
      and public.auth_company_id() = p_company_id
    )
    or public.is_assigned_guide_for(p_company_id)
  ) then
    raise exception 'roll_quarter: not permitted for this company'
      using errcode = '42501';
  end if;

  if p_label is null or btrim(p_label) = '' then
    raise exception 'roll_quarter: the new quarter needs a label';
  end if;
  if p_start_date is null or p_end_date is null then
    raise exception 'roll_quarter: the new quarter needs both dates';
  end if;
  if p_end_date < p_start_date then
    raise exception 'roll_quarter: the end date cannot come before the start date';
  end if;

  -- There may be none, and that is a normal state rather than an
  -- error: a company whose quarter was never opened, or one rolling
  -- after somebody closed by hand. Then this is simply an open.
  select id into v_old
    from public.quarters
   where company_id = p_company_id and status = 'open';

  if v_old is not null then
    update public.quarters set status = 'closed' where id = v_old;
  end if;

  insert into public.quarters (company_id, label, start_date, end_date, status)
  values (p_company_id, btrim(p_label), p_start_date, p_end_date, 'open')
  returning id into v_new;

  -- The carry-forward. Complete priorities stay where they were
  -- finished, which is what makes the closed quarter an honest record
  -- of what the team actually landed.
  if v_old is not null then
    update public.priorities
       set quarter_id = v_new
     where quarter_id = v_old
       and status <> 'complete';
    get diagnostics v_moved = row_count;
  end if;

  return query select v_old, v_new, v_moved;
end;
$function$;
-- record_external_pull: admits system_admin, the company's own company_admin, an assigned aims_guide.
CREATE OR REPLACE FUNCTION public.record_external_pull(p_measure_id uuid, p_week_ending date, p_mapping_kind text, p_outcome text, p_value numeric DEFAULT NULL::numeric, p_failure_reason text DEFAULT NULL::text, p_detail jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(outcome text, log_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_company uuid;
begin
  if v_uid is null then
    raise exception 'record_external_pull requires an authenticated caller';
  end if;

  select f.company_id into v_company
  from public.success_measures m
  join public.functions f on f.id = m.function_id
  where m.id = p_measure_id;

  if v_company is null then
    raise exception 'record_external_pull: no such measure, or it belongs to no function';
  end if;

  if not (
    public.auth_role() = 'system_admin'
    or (
      public.auth_role() = 'company_admin'
      and public.auth_company_id() = v_company
    )
    or public.is_assigned_guide_for(v_company)
  ) then
    raise exception 'record_external_pull: not permitted for this company'
      using errcode = '42501';
  end if;

  -- A person pressing Pull now is asking for a fresh read, so a
  -- value this feature wrote earlier may be replaced. A value a
  -- person typed may not, and that is decided inside.
  return query select * from public._record_external_pull(
    p_measure_id, p_week_ending, p_mapping_kind, p_outcome,
    p_value, p_failure_reason, p_detail, v_uid, true
  );
end;
$function$;
