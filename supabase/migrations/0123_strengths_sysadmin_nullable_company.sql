-- =============================================================
-- Migration 0123 — allow system_admins to take the strengths
-- assessment.
--
-- System admins aren't attached to any company, so the original
-- strengths_assessments schema (NOT NULL company_id, RLS gated on
-- company_has_feature) blocked them entirely. This migration:
--   1. Makes strengths_assessments.company_id nullable.
--   2. Rewrites RLS on strengths_assessments so a NULL company_id
--      is only accepted when the caller is a system_admin (so a
--      regular member can't bypass the feature gate by inserting
--      a NULL-company row).
--   3. Rewrites the transitive RLS on responses / narrative /
--      results so their reads/writes also work for a NULL-company
--      parent assessment.
--
-- Team-scoped tables (strengths_teams, team_members, team_insights,
-- team_evaluations) stay company-required — a sysadmin's individual
-- assessment is intentionally excluded from team scoring since they
-- aren't part of any team roster.
-- =============================================================

alter table public.strengths_assessments
  alter column company_id drop not null;

-- ---- assessments -------------------------------------------------
drop policy if exists strengths_assessments_select on public.strengths_assessments;
drop policy if exists strengths_assessments_insert on public.strengths_assessments;

create policy strengths_assessments_select on public.strengths_assessments
for select to authenticated
using (
  (
    -- Company-attached row: normal feature-gated read.
    public.strengths_assessments.company_id is not null
    and public.company_has_feature(public.strengths_assessments.company_id, 'strengths')
    and (
      user_id = auth.uid()
      or exists (
        select 1 from public.auth_profile() ap
        where ap.role = 'system_admin'
           or (ap.role = 'company_admin' and ap.company_id = public.strengths_assessments.company_id)
      )
    )
  )
  or (
    -- Sysadmin personal row: readable by its owner + other sysadmins.
    public.strengths_assessments.company_id is null
    and (
      user_id = auth.uid()
      or exists (
        select 1 from public.auth_profile() ap
        where ap.role = 'system_admin'
      )
    )
  )
);

create policy strengths_assessments_insert on public.strengths_assessments
for insert to authenticated
with check (
  user_id = auth.uid()
  and (
    (
      public.strengths_assessments.company_id is not null
      and public.company_has_feature(public.strengths_assessments.company_id, 'strengths')
    )
    or (
      -- NULL company_id only allowed for system_admins so a regular
      -- member can't bypass the feature gate by writing a NULL row.
      public.strengths_assessments.company_id is null
      and exists (
        select 1 from public.auth_profile() ap
        where ap.role = 'system_admin'
      )
    )
  )
);

-- ---- responses (transitive on assessment) -----------------------
drop policy if exists strengths_responses_select on public.strengths_responses;

create policy strengths_responses_select on public.strengths_responses
for select to authenticated
using (
  exists (
    select 1 from public.strengths_assessments a
    where a.id = public.strengths_responses.assessment_id
      and (
        (a.company_id is not null and public.company_has_feature(a.company_id, 'strengths'))
        or a.company_id is null
      )
      and (
        a.user_id = auth.uid()
        or exists (
          select 1 from public.auth_profile() ap
          where ap.role = 'system_admin'
             or (ap.role = 'company_admin' and a.company_id is not null and ap.company_id = a.company_id)
        )
      )
  )
);

-- ---- narrative_messages (transitive on assessment) --------------
drop policy if exists strengths_narrative_select on public.strengths_narrative_messages;

create policy strengths_narrative_select on public.strengths_narrative_messages
for select to authenticated
using (
  exists (
    select 1 from public.strengths_assessments a
    where a.id = public.strengths_narrative_messages.assessment_id
      and (
        (a.company_id is not null and public.company_has_feature(a.company_id, 'strengths'))
        or a.company_id is null
      )
      and (
        a.user_id = auth.uid()
        or exists (
          select 1 from public.auth_profile() ap
          where ap.role = 'system_admin'
             or (ap.role = 'company_admin' and a.company_id is not null and ap.company_id = a.company_id)
        )
      )
  )
);

-- ---- results (transitive on assessment) -------------------------
drop policy if exists strengths_results_select on public.strengths_results;

create policy strengths_results_select on public.strengths_results
for select to authenticated
using (
  exists (
    select 1 from public.strengths_assessments a
    where a.id = public.strengths_results.assessment_id
      and (
        (a.company_id is not null and public.company_has_feature(a.company_id, 'strengths'))
        or a.company_id is null
      )
      and (
        a.user_id = auth.uid()
        or exists (
          select 1 from public.auth_profile() ap
          where ap.role = 'system_admin'
             or (ap.role = 'company_admin' and a.company_id is not null and ap.company_id = a.company_id)
        )
      )
  )
);
