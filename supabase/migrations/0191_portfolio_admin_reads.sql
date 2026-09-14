-- =============================================================
-- Migration 0191: what a portfolio_admin may read.
--
-- Instance-wide read on company CONTENT. One permissive SELECT policy
-- per table, added beside the existing ones and never editing them,
-- so nothing any existing role can see changes by a character. If
-- every policy in this file were dropped tomorrow, every other role
-- would read exactly what it reads today.
--
-- THE PREDICATE IS (select public.is_portfolio_admin()) EVERYWHERE.
-- Argument-free, so it is an InitPlan evaluated once per statement
-- rather than a call per row. Form D, per docs/f8-rls-hoist.md.
--
-- ---- The one thing that is not mechanical --------------------
--
-- A NULL company_id is not this role's company. Several tables carry
-- rows that belong to no tenant: a meeting ingested before it was
-- routed, a profile with no company (every system_admin, every guide,
-- every other portfolio_admin), a strengths assessment taken outside
-- a company. A portfolio_admin's scope is "every company on the
-- instance", and a row with no company is not in it.
--
-- This is hazard 1 from docs/failure-modes.md in its exact shape: a
-- caller with no company, a row with no company, and a predicate that
-- accidentally matches them to each other. is_portfolio_admin() does
-- not compare companies at all, so the trap cannot spring through the
-- role check itself. It springs through the TRAVERSAL: an EXISTS onto
-- a parent whose company_id is NULL is still an EXISTS that finds a
-- row. So every policy below whose row can reach a NULL company
-- carries an explicit `is not null`, and the harness measures it with
-- a seeded unrouted row and a system_admin control that can see it.
--
-- ---- What is deliberately NOT here ---------------------------
--
-- Named, because a reader should be able to tell an omission from an
-- oversight:
--
--   coaching_conversations, coaching_messages,
--   coaching_conversation_shares, coaching_conversation_analyses
--     Private 1:1 coaching. A company_admin cannot read these about
--     their own people; the owner and explicit shares can. A
--     portfolio_admin reading them would be a wider grant than any
--     role in the product has, granted to the role furthest from the
--     conversation.
--
--   notifications          recipient-only, personal
--   session_briefs         the generating guide's own working notes
--   oauth_credentials      credentials, not content
--   guide_assignments      administrative, and not in the write
--                          allowlist either
--   anthropic_daily_cost, coach_token_usage, coach_theme_snapshot
--                          platform cost and ops telemetry
--   transcript_source_audit_log, company_settings_events,
--   portfolio_admin_events
--                          audit logs, system_admin only by design
--   instances              the control-plane registry
--
-- The classroom tables ARE here, and that is the one call in this
-- file that could reasonably have gone the other way. They hold
-- platform-authored training rather than anything a company produced.
-- They are included because the alternative is a scoped-in
-- portfolio_admin opening Classroom and seeing an empty shelf, which
-- reads as a broken page rather than as a boundary. Only published
-- rows, which is what a member of an entitled company sees. Reversing
-- it is four drops.
-- =============================================================

-- ---- Direct company_id, NOT NULL ----------------------------
--
-- The column cannot be null, so the role check alone is the whole
-- predicate and the policy costs one InitPlan per statement.

drop policy if exists annual_goals_select_portfolio on public.annual_goals;
create policy annual_goals_select_portfolio on public.annual_goals
for select to authenticated
using ((select public.is_portfolio_admin()));

drop policy if exists commitments_select_portfolio on public.commitments;
create policy commitments_select_portfolio on public.commitments
for select to authenticated
using ((select public.is_portfolio_admin()));

drop policy if exists companies_select_portfolio on public.companies;
create policy companies_select_portfolio on public.companies
for select to authenticated
using ((select public.is_portfolio_admin()));

drop policy if exists company_discipline_snapshots_select_portfolio on public.company_discipline_snapshots;
create policy company_discipline_snapshots_select_portfolio on public.company_discipline_snapshots
for select to authenticated
using ((select public.is_portfolio_admin()));

drop policy if exists company_features_select_portfolio on public.company_features;
create policy company_features_select_portfolio on public.company_features
for select to authenticated
using ((select public.is_portfolio_admin()));

drop policy if exists company_foundation_select_portfolio on public.company_foundation;
create policy company_foundation_select_portfolio on public.company_foundation
for select to authenticated
using ((select public.is_portfolio_admin()));

drop policy if exists dashboard_ai_briefs_select_portfolio on public.dashboard_ai_briefs;
create policy dashboard_ai_briefs_select_portfolio on public.dashboard_ai_briefs
for select to authenticated
using ((select public.is_portfolio_admin()));

drop policy if exists foundation_items_select_portfolio on public.foundation_items;
create policy foundation_items_select_portfolio on public.foundation_items
for select to authenticated
using ((select public.is_portfolio_admin()));

drop policy if exists functional_areas_select_portfolio on public.functional_areas;
create policy functional_areas_select_portfolio on public.functional_areas
for select to authenticated
using ((select public.is_portfolio_admin()));

drop policy if exists functions_select_portfolio on public.functions;
create policy functions_select_portfolio on public.functions
for select to authenticated
using ((select public.is_portfolio_admin()));

drop policy if exists issues_select_portfolio on public.issues;
create policy issues_select_portfolio on public.issues
for select to authenticated
using ((select public.is_portfolio_admin()));

drop policy if exists marketing_snippets_select_portfolio on public.marketing_snippets;
create policy marketing_snippets_select_portfolio on public.marketing_snippets
for select to authenticated
using ((select public.is_portfolio_admin()));

drop policy if exists marketing_strategy_select_portfolio on public.marketing_strategy;
create policy marketing_strategy_select_portfolio on public.marketing_strategy
for select to authenticated
using ((select public.is_portfolio_admin()));

drop policy if exists messaging_pillars_select_portfolio on public.messaging_pillars;
create policy messaging_pillars_select_portfolio on public.messaging_pillars
for select to authenticated
using ((select public.is_portfolio_admin()));

drop policy if exists priorities_select_portfolio on public.priorities;
create policy priorities_select_portfolio on public.priorities
for select to authenticated
using ((select public.is_portfolio_admin()));

drop policy if exists quarters_select_portfolio on public.quarters;
create policy quarters_select_portfolio on public.quarters
for select to authenticated
using ((select public.is_portfolio_admin()));

drop policy if exists scorecard_entries_select_portfolio on public.scorecard_entries;
create policy scorecard_entries_select_portfolio on public.scorecard_entries
for select to authenticated
using ((select public.is_portfolio_admin()));

drop policy if exists scorecard_metrics_select_portfolio on public.scorecard_metrics;
create policy scorecard_metrics_select_portfolio on public.scorecard_metrics
for select to authenticated
using ((select public.is_portfolio_admin()));

drop policy if exists strategic_focus_areas_select_portfolio on public.strategic_focus_areas;
create policy strategic_focus_areas_select_portfolio on public.strategic_focus_areas
for select to authenticated
using ((select public.is_portfolio_admin()));

drop policy if exists strengths_team_insights_select_portfolio on public.strengths_team_insights;
create policy strengths_team_insights_select_portfolio on public.strengths_team_insights
for select to authenticated
using ((select public.is_portfolio_admin()));

drop policy if exists strengths_teams_select_portfolio on public.strengths_teams;
create policy strengths_teams_select_portfolio on public.strengths_teams
for select to authenticated
using ((select public.is_portfolio_admin()));

drop policy if exists transcript_aliases_select_portfolio on public.transcript_aliases;
create policy transcript_aliases_select_portfolio on public.transcript_aliases
for select to authenticated
using ((select public.is_portfolio_admin()));

-- ---- Direct company_id, NULLABLE ----------------------------
--
-- Same check, plus the null guard. Without it these four are
-- hazard 1: the role would see rows belonging to no tenant.

-- an unrouted meeting belongs to no tenant
drop policy if exists meetings_select_portfolio on public.meetings;
create policy meetings_select_portfolio on public.meetings
for select to authenticated
using ((select public.is_portfolio_admin())
  and public.meetings.company_id is not null);

-- every system_admin, guide and portfolio_admin has no company
drop policy if exists profiles_select_portfolio on public.profiles;
create policy profiles_select_portfolio on public.profiles
for select to authenticated
using ((select public.is_portfolio_admin())
  and public.profiles.company_id is not null);

-- a source may be connected before it is routed
drop policy if exists transcript_sources_select_portfolio on public.transcript_sources;
create policy transcript_sources_select_portfolio on public.transcript_sources
for select to authenticated
using ((select public.is_portfolio_admin())
  and public.transcript_sources.company_id is not null);

-- an assessment may be taken outside a company
drop policy if exists strengths_assessments_select_portfolio on public.strengths_assessments;
create policy strengths_assessments_select_portfolio on public.strengths_assessments
for select to authenticated
using ((select public.is_portfolio_admin())
  and public.strengths_assessments.company_id is not null);

-- ---- Reached through a parent, parent NOT NULL --------------
--
-- The EXISTS is not doing access control here: the parent's
-- company_id is NOT NULL and the foreign key is too, so it is
-- always true. It is present so that these policies say the same
-- thing as the ones they sit beside, and so the day a parent
-- becomes nullable the shape is already there to add a guard to.

drop policy if exists commitment_occurrences_select_portfolio on public.commitment_occurrences;
create policy commitment_occurrences_select_portfolio on public.commitment_occurrences
for select to authenticated
using ((select public.is_portfolio_admin())
  and exists (
    select 1 from public.commitments c
     where c.id = public.commitment_occurrences.commitment_id
  ));

drop policy if exists csf_kpi_links_select_portfolio on public.csf_kpi_links;
create policy csf_kpi_links_select_portfolio on public.csf_kpi_links
for select to authenticated
using ((select public.is_portfolio_admin())
  and exists (
    select 1 from public.success_measures m
       join public.functions f on f.id = m.function_id
     where m.id = public.csf_kpi_links.csf_id
  ));

drop policy if exists function_competencies_select_portfolio on public.function_competencies;
create policy function_competencies_select_portfolio on public.function_competencies
for select to authenticated
using ((select public.is_portfolio_admin())
  and exists (
    select 1 from public.functions f
     where f.id = public.function_competencies.function_id
  ));

drop policy if exists function_decision_rights_select_portfolio on public.function_decision_rights;
create policy function_decision_rights_select_portfolio on public.function_decision_rights
for select to authenticated
using ((select public.is_portfolio_admin())
  and exists (
    select 1 from public.functions f
     where f.id = public.function_decision_rights.function_id
  ));

drop policy if exists function_roles_select_portfolio on public.function_roles;
create policy function_roles_select_portfolio on public.function_roles
for select to authenticated
using ((select public.is_portfolio_admin())
  and exists (
    select 1 from public.functions f
     where f.id = public.function_roles.function_id
  ));

drop policy if exists role_description_documents_select_portfolio on public.role_description_documents;
create policy role_description_documents_select_portfolio on public.role_description_documents
for select to authenticated
using ((select public.is_portfolio_admin())
  and exists (
    select 1 from public.functions f
     where f.id = public.role_description_documents.function_id
  ));

drop policy if exists role_description_versions_select_portfolio on public.role_description_versions;
create policy role_description_versions_select_portfolio on public.role_description_versions
for select to authenticated
using ((select public.is_portfolio_admin())
  and exists (
    select 1 from public.functions f
     where f.id = public.role_description_versions.function_id
  ));

drop policy if exists success_measures_select_portfolio on public.success_measures;
create policy success_measures_select_portfolio on public.success_measures
for select to authenticated
using ((select public.is_portfolio_admin())
  and exists (
    select 1 from public.functions f
     where f.id = public.success_measures.function_id
  ));

drop policy if exists success_measure_entries_select_portfolio on public.success_measure_entries;
create policy success_measure_entries_select_portfolio on public.success_measure_entries
for select to authenticated
using ((select public.is_portfolio_admin())
  and exists (
    select 1 from public.success_measures m
       join public.functions f on f.id = m.function_id
     where m.id = public.success_measure_entries.measure_id
  ));

drop policy if exists strengths_team_members_select_portfolio on public.strengths_team_members;
create policy strengths_team_members_select_portfolio on public.strengths_team_members
for select to authenticated
using ((select public.is_portfolio_admin())
  and exists (
    select 1 from public.strengths_teams t
     where t.id = public.strengths_team_members.team_id
  ));

drop policy if exists strengths_team_evaluations_select_portfolio on public.strengths_team_evaluations;
create policy strengths_team_evaluations_select_portfolio on public.strengths_team_evaluations
for select to authenticated
using ((select public.is_portfolio_admin())
  and exists (
    select 1 from public.strengths_teams t
     where t.id = public.strengths_team_evaluations.team_id
  ));

-- ---- Reached through a parent, parent NULLABLE --------------
--
-- These five are where the trap actually lives. An EXISTS onto a
-- parent with a NULL company_id still finds a row; the guard has
-- to be inside the subquery, on the parent, not outside it.

drop policy if exists meeting_analyses_select_portfolio on public.meeting_analyses;
create policy meeting_analyses_select_portfolio on public.meeting_analyses
for select to authenticated
using ((select public.is_portfolio_admin())
  and exists (
    select 1 from public.meetings m
     where m.id = public.meeting_analyses.meeting_id
       and m.company_id is not null
  ));

drop policy if exists strengths_narrative_messages_select_portfolio on public.strengths_narrative_messages;
create policy strengths_narrative_messages_select_portfolio on public.strengths_narrative_messages
for select to authenticated
using ((select public.is_portfolio_admin())
  and exists (
    select 1 from public.strengths_assessments a
     where a.id = public.strengths_narrative_messages.assessment_id
       and a.company_id is not null
  ));

drop policy if exists strengths_responses_select_portfolio on public.strengths_responses;
create policy strengths_responses_select_portfolio on public.strengths_responses
for select to authenticated
using ((select public.is_portfolio_admin())
  and exists (
    select 1 from public.strengths_assessments a
     where a.id = public.strengths_responses.assessment_id
       and a.company_id is not null
  ));

drop policy if exists strengths_results_select_portfolio on public.strengths_results;
create policy strengths_results_select_portfolio on public.strengths_results
for select to authenticated
using ((select public.is_portfolio_admin())
  and exists (
    select 1 from public.strengths_assessments a
     where a.id = public.strengths_results.assessment_id
       and a.company_id is not null
  ));

drop policy if exists user_strengths_select_portfolio on public.user_strengths;
create policy user_strengths_select_portfolio on public.user_strengths
for select to authenticated
using ((select public.is_portfolio_admin())
  and exists (
    select 1 from public.profiles p
     where p.id = public.user_strengths.user_id
       and p.company_id is not null
  ));

-- ---- Platform catalogues -----------------------------------
--
-- Not company content. Included so a scoped-in portfolio_admin
-- sees the same shelves a member of an entitled company sees,
-- rather than an empty page that reads as a bug. Published rows
-- only, matching the member view.

drop policy if exists strengths_items_select_portfolio on public.strengths_items;
create policy strengths_items_select_portfolio on public.strengths_items
for select to authenticated
using ((select public.is_portfolio_admin()));

drop policy if exists classroom_categories_select_portfolio on public.classroom_categories;
create policy classroom_categories_select_portfolio on public.classroom_categories
for select to authenticated
using ((select public.is_portfolio_admin()));

drop policy if exists classroom_tags_select_portfolio on public.classroom_tags;
create policy classroom_tags_select_portfolio on public.classroom_tags
for select to authenticated
using ((select public.is_portfolio_admin()));

drop policy if exists classroom_lessons_select_portfolio on public.classroom_lessons;
create policy classroom_lessons_select_portfolio on public.classroom_lessons
for select to authenticated
using ((select public.is_portfolio_admin()) and published = true);

drop policy if exists classroom_trainings_select_portfolio on public.classroom_trainings;
create policy classroom_trainings_select_portfolio on public.classroom_trainings
for select to authenticated
using ((select public.is_portfolio_admin())
  and published = true
  and exists (
    select 1 from public.classroom_lessons l
     where l.id = public.classroom_trainings.lesson_id
       and l.published = true
  ));

drop policy if exists classroom_lesson_tags_select_portfolio on public.classroom_lesson_tags;
create policy classroom_lesson_tags_select_portfolio on public.classroom_lesson_tags
for select to authenticated
using ((select public.is_portfolio_admin())
  and exists (
    select 1 from public.classroom_lessons l
     where l.id = public.classroom_lesson_tags.lesson_id
       and l.published = true
  ));

drop policy if exists classroom_attachments_select_portfolio on public.classroom_attachments;
create policy classroom_attachments_select_portfolio on public.classroom_attachments
for select to authenticated
using ((select public.is_portfolio_admin())
  and exists (
    select 1 from public.classroom_trainings t
     where t.id = public.classroom_attachments.training_id
       and t.published = true
  ));

