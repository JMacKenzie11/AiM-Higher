-- 0323: the guide read rules ask "is this row's company one of mine?"
-- against one list worked out once per query, instead of calling a
-- function for every row.
--
-- WHY. 44 read rules still called is_guide_for(<the row's company>) (or
-- is_admin_for, which it wraps). That function depends on the row, so
-- Postgres cannot work it out once: it runs for every row an assigned
-- guide or an assigned portfolio admin reads, and each call is two
-- lookups of its own. 0247 measured the cost of this shape on
-- production (1.4 seconds against 1.6 ms for 132 measure entries, with
-- the parent joins it also removed) and fixed it for measures and
-- their entries. This is the same fix for every other read rule that
-- still has the call (2026-11-10 performance audit).
--
-- WHAT. In each rule,
--
--     is_guide_for(X)
--
-- becomes
--
--     X = any ((select public.admin_company_ids())::uuid[])
--
-- and nothing else in the rule changes. admin_company_ids() (0247) is
-- the set is_admin_for() admits, as one array: the companies an
-- aims_guide is assigned to and the companies a portfolio_admin is
-- assigned to, read from the same two tables with the same role
-- checks. Wrapped in a scalar subquery it is an InitPlan, evaluated
-- once per statement (docs/f8-rls-hoist.md, form D).
--
-- WHO READS WHAT IS UNCHANGED. ALTER POLICY ... USING replaces the
-- expression only: each rule keeps its name, its command (SELECT) and
-- its roles. X is null for a row with no company, and both forms then
-- admit nobody.
--
-- READ RULES ONLY. admin_company_ids() admits assigned portfolio
-- admins, so it must never appear in a write rule (CLAUDE.md,
-- Permissions; failure mode E19). The four write rules that call
-- is_guide_for are left exactly as they are: a write is judged one row
-- at a time, and they mean to admit who they admit.
--
-- Not here: the rules that reach the company through a parent row keep
-- their join (commitment_occurrences, function_roles, meeting_analyses,
-- scorecard_entries, the strengths children, success_measure_targets).
-- Only the call inside the join changes. Giving those tables a
-- company_id of their own, as 0247 did for measures, is separate work.
--
-- Every expression below is the rule as it stands on a database at
-- 0322, with that one substitution and the schema names written out.

alter policy annual_goals_select_guide on public.annual_goals
  using ((company_id = any ((select public.admin_company_ids())::uuid[])));

alter policy assistant_actions_select on public.assistant_actions
  using (((profile_id = (select auth.uid())) or ((select public.auth_role()) = 'system_admin'::text) or ((company_id is not null) and ((((select public.auth_role()) = 'company_admin'::text) and ((select public.auth_company_id()) = company_id)) or (company_id = any ((select public.admin_company_ids())::uuid[]))))));

alter policy commitment_occurrences_select on public.commitment_occurrences
  using ((exists (select 1 from public.commitments c where ((c.id = commitment_occurrences.commitment_id) and (((select public.auth_role()) = 'system_admin'::text) or (((select public.auth_company_id()) is not null) and ((select public.auth_company_id()) = c.company_id)) or (c.company_id = any ((select public.admin_company_ids())::uuid[])))))));

alter policy commitments_select_guide on public.commitments
  using ((company_id = any ((select public.admin_company_ids())::uuid[])));

alter policy companies_select_guide on public.companies
  using ((id = any ((select public.admin_company_ids())::uuid[])));

alter policy company_discipline_snapshots_select on public.company_discipline_snapshots
  using ((((select public.auth_company_id()) = company_id) or (company_id = any ((select public.admin_company_ids())::uuid[])) or ((select public.auth_role()) = 'system_admin'::text)));

alter policy company_feature_events_select_guide on public.company_feature_events
  using ((company_id = any ((select public.admin_company_ids())::uuid[])));

alter policy company_features_select_guide on public.company_features
  using ((company_id = any ((select public.admin_company_ids())::uuid[])));

alter policy company_foundation_select_guide on public.company_foundation
  using ((company_id = any ((select public.admin_company_ids())::uuid[])));

alter policy company_settings_events_select_guide on public.company_settings_events
  using ((company_id = any ((select public.admin_company_ids())::uuid[])));

alter policy dashboard_ai_briefs_select_guide on public.dashboard_ai_briefs
  using ((company_id = any ((select public.admin_company_ids())::uuid[])));

alter policy external_pull_log_select_guide on public.external_pull_log
  using ((company_id = any ((select public.admin_company_ids())::uuid[])));

alter policy foundation_items_select_guide on public.foundation_items
  using ((company_id = any ((select public.admin_company_ids())::uuid[])));

alter policy function_roles_select_guide on public.function_roles
  using ((exists (select 1 from public.functions f where ((f.id = function_roles.function_id) and (f.company_id = any ((select public.admin_company_ids())::uuid[]))))));

alter policy functional_areas_select_guide on public.functional_areas
  using ((company_id = any ((select public.admin_company_ids())::uuid[])));

alter policy functions_select_guide on public.functions
  using ((company_id = any ((select public.admin_company_ids())::uuid[])));

alter policy issues_select on public.issues
  using ((((select public.auth_role()) = 'system_admin'::text) or (((select public.auth_company_id()) is not null) and ((select public.auth_company_id()) = company_id)) or (company_id = any ((select public.admin_company_ids())::uuid[]))));

alter policy marketing_snippets_select_guide on public.marketing_snippets
  using ((company_id = any ((select public.admin_company_ids())::uuid[])));

alter policy marketing_strategy_select_guide on public.marketing_strategy
  using ((company_id = any ((select public.admin_company_ids())::uuid[])));

alter policy meeting_analyses_select_guide on public.meeting_analyses
  using ((exists (select 1 from public.meetings m where ((m.id = meeting_analyses.meeting_id) and (m.company_id is not null) and (m.company_id = any ((select public.admin_company_ids())::uuid[]))))));

alter policy meeting_attendance_select on public.meeting_attendance
  using ((((select public.auth_role()) = 'system_admin'::text) or (((select public.auth_company_id()) is not null) and ((select public.auth_company_id()) = company_id)) or (company_id = any ((select public.admin_company_ids())::uuid[]))));

alter policy meeting_checkins_select on public.meeting_checkins
  using ((((select public.auth_role()) = 'system_admin'::text) or (((select public.auth_company_id()) is not null) and ((select public.auth_company_id()) = company_id)) or (company_id = any ((select public.admin_company_ids())::uuid[]))));

alter policy meeting_headlines_select on public.meeting_headlines
  using ((((select public.auth_role()) = 'system_admin'::text) or (((select public.auth_company_id()) is not null) and ((select public.auth_company_id()) = company_id)) or (company_id = any ((select public.admin_company_ids())::uuid[]))));

alter policy meetings_select_guide on public.meetings
  using (((company_id is not null) and (company_id = any ((select public.admin_company_ids())::uuid[]))));

alter policy messaging_pillars_select_guide on public.messaging_pillars
  using ((company_id = any ((select public.admin_company_ids())::uuid[])));

alter policy priorities_select_guide on public.priorities
  using ((company_id = any ((select public.admin_company_ids())::uuid[])));

alter policy profiles_select_guide on public.profiles
  using (((company_id is not null) and (company_id = any ((select public.admin_company_ids())::uuid[]))));

alter policy quarters_select_guide on public.quarters
  using ((company_id = any ((select public.admin_company_ids())::uuid[])));

alter policy role_description_versions_select on public.role_description_versions
  using ((((select public.auth_role()) = 'system_admin'::text) or (((select public.auth_company_id()) is not null) and ((select public.auth_company_id()) = company_id)) or (company_id = any ((select public.admin_company_ids())::uuid[]))));

alter policy role_descriptions_select on public.role_descriptions
  using ((((select public.auth_role()) = 'system_admin'::text) or (((select public.auth_company_id()) is not null) and ((select public.auth_company_id()) = company_id)) or (company_id = any ((select public.admin_company_ids())::uuid[]))));

alter policy scorecard_entries_select_guide on public.scorecard_entries
  using ((exists (select 1 from public.scorecard_metrics m where ((m.id = scorecard_entries.metric_id) and (m.company_id = any ((select public.admin_company_ids())::uuid[]))))));

alter policy scorecard_metrics_select_guide on public.scorecard_metrics
  using ((company_id = any ((select public.admin_company_ids())::uuid[])));

alter policy session_briefs_select on public.session_briefs
  using ((((select public.auth_role()) = 'system_admin'::text) or ((generated_by = (select auth.uid())) and (company_id = any ((select public.admin_company_ids())::uuid[])))));

alter policy strategic_focus_areas_select_guide on public.strategic_focus_areas
  using ((company_id = any ((select public.admin_company_ids())::uuid[])));

alter policy strengths_assessments_select_guide on public.strengths_assessments
  using ((public.company_has_feature(company_id, 'strengths'::text) and (company_id = any ((select public.admin_company_ids())::uuid[]))));

alter policy strengths_results_select_guide on public.strengths_results
  using ((exists (select 1 from public.strengths_assessments a where ((a.id = strengths_results.assessment_id) and public.company_has_feature(a.company_id, 'strengths'::text) and (a.company_id = any ((select public.admin_company_ids())::uuid[]))))));

alter policy strengths_team_evaluations_select_guide on public.strengths_team_evaluations
  using ((exists (select 1 from public.strengths_teams t where ((t.id = strengths_team_evaluations.team_id) and public.company_has_feature(t.company_id, 'strengths'::text) and (t.company_id = any ((select public.admin_company_ids())::uuid[]))))));

alter policy strengths_team_insights_select_guide on public.strengths_team_insights
  using ((public.company_has_feature(company_id, 'strengths'::text) and (company_id = any ((select public.admin_company_ids())::uuid[]))));

alter policy strengths_team_members_select_guide on public.strengths_team_members
  using ((exists (select 1 from public.strengths_teams t where ((t.id = strengths_team_members.team_id) and public.company_has_feature(t.company_id, 'strengths'::text) and (t.company_id = any ((select public.admin_company_ids())::uuid[]))))));

alter policy strengths_teams_select_guide on public.strengths_teams
  using ((public.company_has_feature(company_id, 'strengths'::text) and (company_id = any ((select public.admin_company_ids())::uuid[]))));

alter policy success_measure_entry_changes_select on public.success_measure_entry_changes
  using ((((select public.auth_role()) = 'system_admin'::text) or (((select public.auth_company_id()) is not null) and ((select public.auth_company_id()) = company_id)) or (company_id = any ((select public.admin_company_ids())::uuid[]))));

alter policy success_measure_targets_select_guide on public.success_measure_targets
  using ((exists (select 1 from (public.success_measures m join public.functions f on ((f.id = m.function_id))) where ((m.id = success_measure_targets.measure_id) and (f.company_id = any ((select public.admin_company_ids())::uuid[]))))));

alter policy transcript_aliases_select_guide on public.transcript_aliases
  using ((company_id = any ((select public.admin_company_ids())::uuid[])));

alter policy transcript_sources_select_guide on public.transcript_sources
  using (((company_id is not null) and (company_id = any ((select public.admin_company_ids())::uuid[]))));
