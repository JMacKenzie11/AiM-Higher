-- =============================================================
-- Migration 0131 — guide RLS policies for the Strengths Teams family
--
-- 0102_strengths_rls.sql scoped the strengths_teams* tables to
-- system_admin + company_admin only. Per the guides-as-company-admins
-- policy established in 0111_aims_guide.sql, aims_guide should have
-- the same access on their assigned companies. This migration closes
-- that gap for every company_admin path on the teams-building
-- surface, so a guide who has scoped into a company can:
--   • list, open, create, edit, delete teams
--   • read/modify team members and cached evaluations
--   • read team_insights and the admin path of assessments/results
--     (needed to compose team rosters and evaluate them)
--
-- All mirrors are additive `_guide` policies using is_guide_for();
-- the existing admin policies are left untouched.
-- =============================================================

-- ---- strengths_teams ------------------------------------------
drop policy if exists strengths_teams_select_guide on public.strengths_teams;
create policy strengths_teams_select_guide on public.strengths_teams
for select to authenticated
using (
  public.company_has_feature(public.strengths_teams.company_id, 'strengths')
  and public.is_guide_for(public.strengths_teams.company_id)
);

drop policy if exists strengths_teams_insert_guide on public.strengths_teams;
create policy strengths_teams_insert_guide on public.strengths_teams
for insert to authenticated
with check (
  public.company_has_feature(public.strengths_teams.company_id, 'strengths')
  and public.is_guide_for(public.strengths_teams.company_id)
);

drop policy if exists strengths_teams_update_guide on public.strengths_teams;
create policy strengths_teams_update_guide on public.strengths_teams
for update to authenticated
using (
  public.is_guide_for(public.strengths_teams.company_id)
)
with check (
  public.is_guide_for(public.strengths_teams.company_id)
);

drop policy if exists strengths_teams_delete_guide on public.strengths_teams;
create policy strengths_teams_delete_guide on public.strengths_teams
for delete to authenticated
using (
  public.is_guide_for(public.strengths_teams.company_id)
);

-- ---- strengths_team_members (gated through parent team) --------
drop policy if exists strengths_team_members_select_guide
  on public.strengths_team_members;
create policy strengths_team_members_select_guide
  on public.strengths_team_members
for select to authenticated
using (
  exists (
    select 1 from public.strengths_teams t
    where t.id = public.strengths_team_members.team_id
      and public.company_has_feature(t.company_id, 'strengths')
      and public.is_guide_for(t.company_id)
  )
);

drop policy if exists strengths_team_members_insert_guide
  on public.strengths_team_members;
create policy strengths_team_members_insert_guide
  on public.strengths_team_members
for insert to authenticated
with check (
  exists (
    select 1 from public.strengths_teams t
    where t.id = public.strengths_team_members.team_id
      and public.is_guide_for(t.company_id)
  )
);

drop policy if exists strengths_team_members_update_guide
  on public.strengths_team_members;
create policy strengths_team_members_update_guide
  on public.strengths_team_members
for update to authenticated
using (
  exists (
    select 1 from public.strengths_teams t
    where t.id = public.strengths_team_members.team_id
      and public.is_guide_for(t.company_id)
  )
)
with check (
  exists (
    select 1 from public.strengths_teams t
    where t.id = public.strengths_team_members.team_id
      and public.is_guide_for(t.company_id)
  )
);

drop policy if exists strengths_team_members_delete_guide
  on public.strengths_team_members;
create policy strengths_team_members_delete_guide
  on public.strengths_team_members
for delete to authenticated
using (
  exists (
    select 1 from public.strengths_teams t
    where t.id = public.strengths_team_members.team_id
      and public.is_guide_for(t.company_id)
  )
);

-- ---- strengths_team_evaluations (read-scoped through parent) ---
drop policy if exists strengths_team_evaluations_select_guide
  on public.strengths_team_evaluations;
create policy strengths_team_evaluations_select_guide
  on public.strengths_team_evaluations
for select to authenticated
using (
  exists (
    select 1 from public.strengths_teams t
    where t.id = public.strengths_team_evaluations.team_id
      and public.company_has_feature(t.company_id, 'strengths')
      and public.is_guide_for(t.company_id)
  )
);

-- ---- strengths_team_insights ----------------------------------
drop policy if exists strengths_team_insights_select_guide
  on public.strengths_team_insights;
create policy strengths_team_insights_select_guide
  on public.strengths_team_insights
for select to authenticated
using (
  public.company_has_feature(
    public.strengths_team_insights.company_id, 'strengths'
  )
  and public.is_guide_for(public.strengths_team_insights.company_id)
);

-- ---- strengths_assessments (admin read path) -------------------
-- Team composition needs to know each candidate's assessment
-- status; the current SELECT policy only lets a caller read their
-- OWN assessment unless they're admin. Mirror the admin path for
-- guides so the eligibility list populates.
drop policy if exists strengths_assessments_select_guide
  on public.strengths_assessments;
create policy strengths_assessments_select_guide
  on public.strengths_assessments
for select to authenticated
using (
  public.company_has_feature(
    public.strengths_assessments.company_id, 'strengths'
  )
  and public.is_guide_for(public.strengths_assessments.company_id)
);

-- ---- strengths_results (admin read path) -----------------------
-- Team evaluation reads the completed profile per candidate. Same
-- pattern as assessments — guides get the admin read path scoped
-- through the parent assessment's company.
drop policy if exists strengths_results_select_guide
  on public.strengths_results;
create policy strengths_results_select_guide
  on public.strengths_results
for select to authenticated
using (
  exists (
    select 1 from public.strengths_assessments a
    where a.id = public.strengths_results.assessment_id
      and public.company_has_feature(a.company_id, 'strengths')
      and public.is_guide_for(a.company_id)
  )
);
