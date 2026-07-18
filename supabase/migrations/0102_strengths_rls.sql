-- =============================================================
-- Merger Phase 5a — Migration 0102: Strengths Map RLS.
--
-- Adapts SM's original inline policies (current_user_role /
-- current_user_company) to AiMSHigher's auth_profile() pattern.
-- Adds a feature-gate via company_has_feature(company_id,
-- 'strengths') so a company that hasn't subscribed to the module
-- can't read or write any of its rows even if they happen to have
-- a matching role.
-- =============================================================

alter table public.strengths_items enable row level security;
alter table public.strengths_assessments enable row level security;
alter table public.strengths_responses enable row level security;
alter table public.strengths_narrative_messages enable row level security;
alter table public.strengths_results enable row level security;
alter table public.strengths_team_insights enable row level security;
alter table public.strengths_teams enable row level security;
alter table public.strengths_team_members enable row level security;
alter table public.strengths_team_evaluations enable row level security;

-- ---- items (readable by any authenticated user with the module) ---
create policy strengths_items_select on public.strengths_items
for select to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.company_id is null
       or public.company_has_feature(ap.company_id, 'strengths')
  )
);

-- ---- assessments ---------------------------------------------
create policy strengths_assessments_select on public.strengths_assessments
for select to authenticated
using (
  public.company_has_feature(public.strengths_assessments.company_id, 'strengths')
  and (
    user_id = auth.uid()
    or exists (
      select 1 from public.auth_profile() ap
      where ap.role = 'system_admin'
         or (ap.role = 'company_admin' and ap.company_id = public.strengths_assessments.company_id)
    )
  )
);

create policy strengths_assessments_insert on public.strengths_assessments
for insert to authenticated
with check (
  user_id = auth.uid()
  and public.company_has_feature(public.strengths_assessments.company_id, 'strengths')
);

create policy strengths_assessments_update on public.strengths_assessments
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- ---- responses (gated through parent assessment) -------------
create policy strengths_responses_select on public.strengths_responses
for select to authenticated
using (
  exists (
    select 1 from public.strengths_assessments a
    where a.id = public.strengths_responses.assessment_id
      and public.company_has_feature(a.company_id, 'strengths')
      and (
        a.user_id = auth.uid()
        or exists (
          select 1 from public.auth_profile() ap
          where ap.role = 'system_admin'
             or (ap.role = 'company_admin' and ap.company_id = a.company_id)
        )
      )
  )
);

create policy strengths_responses_insert on public.strengths_responses
for insert to authenticated
with check (
  exists (
    select 1 from public.strengths_assessments a
    where a.id = public.strengths_responses.assessment_id
      and a.user_id = auth.uid()
  )
);

create policy strengths_responses_update on public.strengths_responses
for update to authenticated
using (
  exists (
    select 1 from public.strengths_assessments a
    where a.id = public.strengths_responses.assessment_id
      and a.user_id = auth.uid()
  )
);

-- ---- narrative_messages --------------------------------------
create policy strengths_narrative_select on public.strengths_narrative_messages
for select to authenticated
using (
  exists (
    select 1 from public.strengths_assessments a
    where a.id = public.strengths_narrative_messages.assessment_id
      and public.company_has_feature(a.company_id, 'strengths')
      and (
        a.user_id = auth.uid()
        or exists (
          select 1 from public.auth_profile() ap
          where ap.role = 'system_admin'
             or (ap.role = 'company_admin' and ap.company_id = a.company_id)
        )
      )
  )
);

create policy strengths_narrative_insert on public.strengths_narrative_messages
for insert to authenticated
with check (
  exists (
    select 1 from public.strengths_assessments a
    where a.id = public.strengths_narrative_messages.assessment_id
      and a.user_id = auth.uid()
  )
);

-- ---- results (server-side writes; broad read scope) ---------
create policy strengths_results_select on public.strengths_results
for select to authenticated
using (
  exists (
    select 1 from public.strengths_assessments a
    where a.id = public.strengths_results.assessment_id
      and public.company_has_feature(a.company_id, 'strengths')
      and (
        a.user_id = auth.uid()
        or exists (
          select 1 from public.auth_profile() ap
          where ap.role = 'system_admin'
             or (ap.role = 'company_admin' and ap.company_id = a.company_id)
        )
      )
  )
);

-- ---- team_insights (admins only, feature-gated) --------------
create policy strengths_team_insights_select on public.strengths_team_insights
for select to authenticated
using (
  public.company_has_feature(public.strengths_team_insights.company_id, 'strengths')
  and exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.strengths_team_insights.company_id)
  )
);

-- ---- teams (admins only, feature-gated) ----------------------
create policy strengths_teams_select on public.strengths_teams
for select to authenticated
using (
  public.company_has_feature(public.strengths_teams.company_id, 'strengths')
  and exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.strengths_teams.company_id)
  )
);

create policy strengths_teams_insert on public.strengths_teams
for insert to authenticated
with check (
  public.company_has_feature(public.strengths_teams.company_id, 'strengths')
  and exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.strengths_teams.company_id)
  )
);

create policy strengths_teams_update on public.strengths_teams
for update to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.strengths_teams.company_id)
  )
)
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.strengths_teams.company_id)
  )
);

create policy strengths_teams_delete on public.strengths_teams
for delete to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.strengths_teams.company_id)
  )
);

-- ---- team_members (gated through parent team) ----------------
create policy strengths_team_members_select on public.strengths_team_members
for select to authenticated
using (
  exists (
    select 1 from public.strengths_teams t
    where t.id = public.strengths_team_members.team_id
      and public.company_has_feature(t.company_id, 'strengths')
      and exists (
        select 1 from public.auth_profile() ap
        where ap.role = 'system_admin'
           or (ap.role = 'company_admin' and ap.company_id = t.company_id)
      )
  )
);

create policy strengths_team_members_insert on public.strengths_team_members
for insert to authenticated
with check (
  exists (
    select 1 from public.strengths_teams t
    where t.id = public.strengths_team_members.team_id
      and exists (
        select 1 from public.auth_profile() ap
        where ap.role = 'system_admin'
           or (ap.role = 'company_admin' and ap.company_id = t.company_id)
      )
  )
);

create policy strengths_team_members_update on public.strengths_team_members
for update to authenticated
using (
  exists (
    select 1 from public.strengths_teams t
    where t.id = public.strengths_team_members.team_id
      and exists (
        select 1 from public.auth_profile() ap
        where ap.role = 'system_admin'
           or (ap.role = 'company_admin' and ap.company_id = t.company_id)
      )
  )
)
with check (
  exists (
    select 1 from public.strengths_teams t
    where t.id = public.strengths_team_members.team_id
      and exists (
        select 1 from public.auth_profile() ap
        where ap.role = 'system_admin'
           or (ap.role = 'company_admin' and ap.company_id = t.company_id)
      )
  )
);

create policy strengths_team_members_delete on public.strengths_team_members
for delete to authenticated
using (
  exists (
    select 1 from public.strengths_teams t
    where t.id = public.strengths_team_members.team_id
      and exists (
        select 1 from public.auth_profile() ap
        where ap.role = 'system_admin'
           or (ap.role = 'company_admin' and ap.company_id = t.company_id)
      )
  )
);

-- ---- team_evaluations (read-scoped through parent; server-side writes) -
create policy strengths_team_evaluations_select on public.strengths_team_evaluations
for select to authenticated
using (
  exists (
    select 1 from public.strengths_teams t
    where t.id = public.strengths_team_evaluations.team_id
      and public.company_has_feature(t.company_id, 'strengths')
      and exists (
        select 1 from public.auth_profile() ap
        where ap.role = 'system_admin'
           or (ap.role = 'company_admin' and ap.company_id = t.company_id)
      )
  )
);
