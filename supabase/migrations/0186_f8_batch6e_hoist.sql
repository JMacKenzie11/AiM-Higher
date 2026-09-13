-- =============================================================
-- Migration 0186: F8 batch 6e — coaching, briefs and issues.
--
-- Seventeen policies across anthropic_daily_cost, coach_theme_snapshot,
-- coach_token_usage, coaching_conversations,
-- coaching_conversation_analyses, company_discipline_snapshots,
-- dashboard_ai_briefs, issues and session_briefs. The _guide policies
-- and the five policies that never called auth_profile() are
-- untouched, with one exception.
--
-- THE EXCEPTION IS coaching_conversations_select AND _update, which
-- never called auth_profile() and are rewritten anyway. They call
-- auth.uid() per row, which is the same tax by a different name, and
-- leaving them would have made this batch's claim - every judged
-- after-plan hoisted - true only of the policies that happened to use
-- the helper. Batch 2 set that precedent on commitments. Note that
-- has_coaching_share() still takes a per-row id and cannot be
-- hoisted; only the caller half moves.
--
-- FOUR OF THESE TABLES ARE PLATFORM TELEMETRY - token usage, daily
-- cost, theme snapshots, conversation analyses - and are system_admin
-- only. Their predicates collapse to a single comparison.
--
-- company_discipline_snapshots CARRIED A HAZARD 3 SHAPE and this
-- removes it. Its predicate compared company_id against a BARE scalar
-- subquery over the set-returning helper:
--
--   company_id = (select auth_profile.company_id from auth_profile())
--
-- That is the exact form hazard 3 exists for: it works only while
-- auth_profile() returns at most one row, and would raise "more than
-- one row returned by a subquery used as an expression" - a 500 on
-- every read of the table, fleet-wide - the day its WHERE changed.
-- auth_company_id() returns uuid and cannot return two rows whatever
-- happens inside it.
--
-- THE OWNER RULES HERE ARE created_by AND generated_by, on coaching
-- conversations, issues and session briefs, plus the reports_to
-- branch that lets a manager open an 'about' conversation on someone
-- who reports to them. All transcribed as (select auth.uid()) and
-- probed.
--
-- Form D throughout. Every is-not-null guard and every mode/subject
-- shape check on coaching_conversations_insert stays exactly as it is.
-- =============================================================

-- ---- anthropic_daily_cost --------------------------

drop policy if exists anthropic_daily_cost_select on public.anthropic_daily_cost;
create policy anthropic_daily_cost_select on public.anthropic_daily_cost
for select to authenticated
using (
  ((select public.auth_role()) = 'system_admin')
);

-- ---- coach_theme_snapshot --------------------------

drop policy if exists coach_theme_snapshot_select on public.coach_theme_snapshot;
create policy coach_theme_snapshot_select on public.coach_theme_snapshot
for select to authenticated
using (
  ((select public.auth_role()) = 'system_admin')
);

-- ---- coach_token_usage -----------------------------

drop policy if exists coach_token_usage_select on public.coach_token_usage;
create policy coach_token_usage_select on public.coach_token_usage
for select to authenticated
using (
  ((select public.auth_role()) = 'system_admin')
);

-- ---- coaching_conversation_analyses ----------------

drop policy if exists coaching_conversation_analyses_select on public.coaching_conversation_analyses;
create policy coaching_conversation_analyses_select on public.coaching_conversation_analyses
for select to authenticated
using (
  ((select public.auth_role()) = 'system_admin')
);

-- ---- coaching_conversations ------------------------

drop policy if exists coaching_conversations_insert on public.coaching_conversations;
create policy coaching_conversations_insert on public.coaching_conversations
for insert to authenticated
with check (
  ((created_by = (select auth.uid())) AND (((mode = 'general'::text) AND (subject_profile_id IS NULL) AND ((select public.auth_role()) = 'system_admin' or ((select public.auth_company_id()) is not null and (select public.auth_company_id()) = coaching_conversations.company_id))) OR ((mode = 'about'::text) AND (subject_profile_id IS NOT NULL) AND (subject_profile_id <> (select auth.uid())) AND (((select public.auth_role()) = 'system_admin' or ((select public.auth_role()) = 'company_admin' and (select public.auth_company_id()) = coaching_conversations.company_id)) OR (EXISTS ( SELECT 1 FROM profiles subj WHERE ((subj.id = coaching_conversations.subject_profile_id) AND (subj.reports_to = (select auth.uid())))))))))
);

drop policy if exists coaching_conversations_select on public.coaching_conversations;
create policy coaching_conversations_select on public.coaching_conversations
for select to authenticated
using (
  public.coaching_conversations.created_by = (select auth.uid())
  or public.has_coaching_share(public.coaching_conversations.id, (select auth.uid()))
);

drop policy if exists coaching_conversations_update on public.coaching_conversations;
create policy coaching_conversations_update on public.coaching_conversations
for update to authenticated
using (public.coaching_conversations.created_by = (select auth.uid()))
with check (public.coaching_conversations.created_by = (select auth.uid()));

-- ---- company_discipline_snapshots ------------------

drop policy if exists company_discipline_snapshots_select on public.company_discipline_snapshots;
create policy company_discipline_snapshots_select on public.company_discipline_snapshots
for select to authenticated
using (
  (((select public.auth_company_id()) = company_id) OR is_guide_for(company_id) OR ((select public.auth_role()) = 'system_admin'))
);

-- ---- dashboard_ai_briefs ---------------------------

drop policy if exists dashboard_ai_briefs_insert on public.dashboard_ai_briefs;
create policy dashboard_ai_briefs_insert on public.dashboard_ai_briefs
for insert to authenticated
with check (
  ((select public.auth_role()) = any (array['company_admin','system_admin']) and ((select public.auth_role()) = 'system_admin' or (select public.auth_company_id()) = dashboard_ai_briefs.company_id))
);

drop policy if exists dashboard_ai_briefs_select on public.dashboard_ai_briefs;
create policy dashboard_ai_briefs_select on public.dashboard_ai_briefs
for select to authenticated
using (
  ((select public.auth_role()) = any (array['company_admin','system_admin']) and ((select public.auth_role()) = 'system_admin' or (select public.auth_company_id()) = dashboard_ai_briefs.company_id))
);

-- ---- issues ----------------------------------------

drop policy if exists issues_insert_admin on public.issues;
create policy issues_insert_admin on public.issues
for insert to authenticated
with check (
  (((select public.auth_role()) = 'system_admin' or ((select public.auth_role()) = 'company_admin' and (select public.auth_company_id()) = issues.company_id)) OR is_guide_for(company_id))
);

drop policy if exists issues_insert_member on public.issues;
create policy issues_insert_member on public.issues
for insert to authenticated
with check (
  ((select public.auth_company_id()) = issues.company_id)
);

drop policy if exists issues_select on public.issues;
create policy issues_select on public.issues
for select to authenticated
using (
  (((select public.auth_role()) = 'system_admin' or ((select public.auth_company_id()) is not null and (select public.auth_company_id()) = issues.company_id)) OR is_guide_for(company_id))
);

drop policy if exists issues_update_admin on public.issues;
create policy issues_update_admin on public.issues
for update to authenticated
using (
  ((select public.auth_role()) = 'system_admin' or ((select public.auth_role()) = 'company_admin' and (select public.auth_company_id()) = issues.company_id))
)
with check (
  ((select public.auth_role()) = 'system_admin' or ((select public.auth_role()) = 'company_admin' and (select public.auth_company_id()) = issues.company_id))
);

drop policy if exists issues_update_creator on public.issues;
create policy issues_update_creator on public.issues
for update to authenticated
using (
  ((created_by = (select auth.uid())) AND ((select public.auth_company_id()) = issues.company_id))
)
with check (
  (created_by = (select auth.uid()))
);

-- ---- session_briefs --------------------------------

drop policy if exists session_briefs_insert on public.session_briefs;
create policy session_briefs_insert on public.session_briefs
for insert to authenticated
with check (
  ((generated_by = (select auth.uid())) AND (((select public.auth_role()) = 'system_admin') OR is_guide_for(company_id)))
);

drop policy if exists session_briefs_select on public.session_briefs;
create policy session_briefs_select on public.session_briefs
for select to authenticated
using (
  (((select public.auth_role()) = 'system_admin') OR ((generated_by = (select auth.uid())) AND is_guide_for(company_id)))
);
