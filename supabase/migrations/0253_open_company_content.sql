-- 0253: everyone in a company reads its content.
--
-- THE PRINCIPLE (Jason, 2026-10-01; docs/investigations/open-data.md,
-- phase D). Inside a company, everyone can read all of the company's
-- data. The one exception is Aimee conversations, their messages and
-- memory, which stay their owner's (0251, 0252). Who can CHANGE data
-- stays exactly as it is: every rule below is a read rule, and no write
-- rule is touched.
--
-- "Everyone in a company" is its own people, through
-- auth_company_id(). Assigned guides, portfolio admins and system
-- admins keep the read rules they already have on these tables, except
-- the two history logs, which only system admins (and, for feature
-- changes, guides and portfolio admins) could read; they gain the
-- company's own people and, for settings changes, guides and portfolio
-- admins too.
--
-- WHAT OPENS (most company content was already open; these were the
-- tables still narrower than "same company"):
--
--   strengths_assessments, strengths_results   a person's strengths
--     profile and its summary (decision 6: results open). Behind the
--     strengths feature, as before.
--   strengths_teams, _team_members, _team_evaluations, _team_insights
--     the team strengths pages, behind the feature.
--   dashboard_ai_briefs   the dashboard's "Week in review".
--   external_pull_log     the sheet pull history beside a measure.
--   company_settings_events, company_feature_events   the company's
--     history of settings and feature changes (decision 9).
--
-- WHAT STAYS PRIVATE (decisions 6 and 8): strengths_responses (a
-- person's raw answers) and strengths_narrative_messages (their
-- assessment conversation), which are closer to an Aimee conversation
-- than to a result; session_briefs (a guide's own preparation);
-- guide_nudges and notifications (addressed to one person);
-- portfolio_admin_events and the other oversight logs.
--
-- Harness: "company content · everyone in the company reads it".

-- Roles for every rule in this file: read only. The company's own
-- people (auth_company_id() = the row's company), whatever their role.

create policy strengths_assessments_select_company on public.strengths_assessments
for select to authenticated
using (
  company_id is not null
  and company_id = (select public.auth_company_id())
  and public.company_has_feature(company_id, 'strengths')
);

create policy strengths_results_select_company on public.strengths_results
for select to authenticated
using (
  exists (
    select 1 from public.strengths_assessments a
    where a.id = strengths_results.assessment_id
      and a.company_id is not null
      and a.company_id = (select public.auth_company_id())
      and public.company_has_feature(a.company_id, 'strengths')
  )
);

create policy strengths_teams_select_company on public.strengths_teams
for select to authenticated
using (
  company_id = (select public.auth_company_id())
  and public.company_has_feature(company_id, 'strengths')
);

create policy strengths_team_members_select_company on public.strengths_team_members
for select to authenticated
using (
  exists (
    select 1 from public.strengths_teams t
    where t.id = strengths_team_members.team_id
      and t.company_id = (select public.auth_company_id())
      and public.company_has_feature(t.company_id, 'strengths')
  )
);

create policy strengths_team_evaluations_select_company on public.strengths_team_evaluations
for select to authenticated
using (
  exists (
    select 1 from public.strengths_teams t
    where t.id = strengths_team_evaluations.team_id
      and t.company_id = (select public.auth_company_id())
      and public.company_has_feature(t.company_id, 'strengths')
  )
);

create policy strengths_team_insights_select_company on public.strengths_team_insights
for select to authenticated
using (
  company_id = (select public.auth_company_id())
  and public.company_has_feature(company_id, 'strengths')
);

create policy dashboard_ai_briefs_select_company on public.dashboard_ai_briefs
for select to authenticated
using (company_id = (select public.auth_company_id()));

create policy external_pull_log_select_company on public.external_pull_log
for select to authenticated
using (company_id = (select public.auth_company_id()));

create policy company_settings_events_select_company on public.company_settings_events
for select to authenticated
using (company_id = (select public.auth_company_id()));

-- Settings history to the people who already read the company's other
-- history: an assigned guide and a portfolio admin.
create policy company_settings_events_select_guide on public.company_settings_events
for select to authenticated
using (public.is_guide_for(company_id));

create policy company_settings_events_select_portfolio on public.company_settings_events
for select to authenticated
using ((select public.is_portfolio_admin()));

create policy company_feature_events_select_company on public.company_feature_events
for select to authenticated
using (company_id = (select public.auth_company_id()));

-- A COLLEAGUE'S EMAIL (decision 7). The person page's Details shows a
-- person's sign-in email, which lives in auth.users, not on the
-- profile. It was read with the service role for every viewer; it is
-- now read through this function, which decides who may see it the
-- way a read rule would.
-- Roles: read only. The person themselves, anyone in their company, an
-- assigned guide, a portfolio admin and a system admin. Anyone else
-- gets null.
create or replace function public.profile_email(p_profile_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select u.email::text
  from auth.users u
  join public.profiles p on p.id = u.id
  where u.id = p_profile_id
    and (
      p_profile_id = (select auth.uid())
      or (select public.auth_role()) = 'system_admin'
      or (
        p.company_id is not null
        and (
          p.company_id = (select public.auth_company_id())
          -- is_assigned_guide_for, not is_guide_for: the guide alone,
          -- with portfolio admins named on the next line (E19).
          or public.is_assigned_guide_for(p.company_id)
          or (select public.is_portfolio_admin())
        )
      )
    );
$$;

revoke all on function public.profile_email(uuid) from public;
revoke all on function public.profile_email(uuid) from anon;
grant execute on function public.profile_email(uuid) to authenticated;
