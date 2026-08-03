-- =============================================================
-- Migration 0111: AiMS Guide role + assignments
--
-- New role 'aims_guide' — a coach who has company_admin-equivalent
-- access across one or more assigned companies, but cannot create
-- or archive companies (those stay system_admin only).
--
-- Storage: profiles.role gains 'aims_guide'. Guides have no
-- profile.company_id (like system_admin); their scope is the set of
-- (guide_id, company_id) rows in the new guide_assignments table.
--
-- Enforcement: rather than rewrite ~100 existing RLS policies, we
-- add SUPPLEMENTARY policies that admit a guide against their
-- assigned company. PostgreSQL OR's policies for the same
-- (table, action) pair, so an aims_guide row passes if EITHER the
-- existing company_admin policy OR the new guide policy holds.
-- Existing behaviour for sysadmin / company_admin / team_member is
-- untouched.
-- =============================================================

-- ---- Role expansion -----------------------------------------
alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('system_admin','company_admin','team_member','aims_guide'));

-- Guides carry no primary company (their scope is the assignments
-- table). Relax the "role_requires_company" constraint accordingly.
alter table public.profiles
  drop constraint if exists profiles_role_requires_company;

alter table public.profiles
  add constraint profiles_role_requires_company
  check (
    role in ('system_admin','aims_guide')
    or company_id is not null
  );

-- ---- guide_assignments --------------------------------------
create table if not exists public.guide_assignments (
  guide_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (guide_id, company_id)
);

create index if not exists guide_assignments_company_idx
  on public.guide_assignments (company_id);

alter table public.guide_assignments enable row level security;
alter table public.guide_assignments force row level security;

-- Read: sysadmin sees all; a guide sees their own rows.
drop policy if exists guide_assignments_select on public.guide_assignments;
create policy guide_assignments_select on public.guide_assignments
for select to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or ap.uid = public.guide_assignments.guide_id
  )
);

-- Insert / delete: sysadmin only. Guides can't manage themselves,
-- and company_admins don't create guides.
drop policy if exists guide_assignments_insert on public.guide_assignments;
create policy guide_assignments_insert on public.guide_assignments
for insert to authenticated
with check (
  exists (select 1 from public.auth_profile() ap where ap.role = 'system_admin')
);

drop policy if exists guide_assignments_delete on public.guide_assignments;
create policy guide_assignments_delete on public.guide_assignments
for delete to authenticated
using (
  exists (select 1 from public.auth_profile() ap where ap.role = 'system_admin')
);

-- ---- is_guide_for helper ------------------------------------
-- Returns true when the current caller is an aims_guide with an
-- assignment against target_company_id. Used in every supplementary
-- policy below. SECURITY DEFINER so it doesn't recurse back through
-- the profiles / guide_assignments policies.
create or replace function public.is_guide_for(target_company_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    join public.guide_assignments ga on ga.guide_id = p.id
    where p.id = auth.uid()
      and p.role = 'aims_guide'
      and ga.company_id = target_company_id
  )
$$;

revoke all on function public.is_guide_for(uuid) from public;
grant execute on function public.is_guide_for(uuid) to authenticated;

-- =============================================================
-- Supplementary policies per company-scoped table.
--
-- Each block adds guide access to a table. The naming convention
-- is <table>_<action>_guide so it's clear which are supplementary.
-- Guides get:
--   - SELECT wherever the table is company-scoped and visible to
--     company members.
--   - INSERT/UPDATE/DELETE wherever the table admits company_admin
--     for that action.
-- Guides do NOT get:
--   - Any access to companies (create/archive stays sysadmin only)
--   - Anything on oauth_credentials except read
--     (transcript setup is handled in a follow-up)
-- =============================================================

-- ---- profiles ------------------------------------------------
-- Guides can see profiles in their assigned companies (so /people
-- and the roster work). They can invite / update / delete non-
-- system-admin, non-guide members of those companies — matches the
-- company_admin surface.
drop policy if exists profiles_select_guide on public.profiles;
create policy profiles_select_guide on public.profiles
for select to authenticated
using (
  public.profiles.company_id is not null
  and public.is_guide_for(public.profiles.company_id)
);

drop policy if exists profiles_insert_guide on public.profiles;
create policy profiles_insert_guide on public.profiles
for insert to authenticated
with check (
  public.profiles.company_id is not null
  and public.is_guide_for(public.profiles.company_id)
  and public.profiles.role in ('company_admin','team_member')
);

drop policy if exists profiles_update_guide on public.profiles;
create policy profiles_update_guide on public.profiles
for update to authenticated
using (
  public.profiles.company_id is not null
  and public.is_guide_for(public.profiles.company_id)
  and public.profiles.id <> auth.uid()
)
with check (
  public.profiles.company_id is not null
  and public.is_guide_for(public.profiles.company_id)
  and public.profiles.role in ('company_admin','team_member')
);

drop policy if exists profiles_delete_guide on public.profiles;
create policy profiles_delete_guide on public.profiles
for delete to authenticated
using (
  public.profiles.company_id is not null
  and public.is_guide_for(public.profiles.company_id)
  and public.profiles.id <> auth.uid()
);

-- ---- invitations table was dropped in migration 0104; users are
--      created via createUserAction directly, no supplementary policy
--      needed here.

-- ---- companies (READ ONLY for guides) -----------------------
-- A guide can read their assigned companies (for pickers, dashboards).
-- They cannot insert / update / delete companies.
drop policy if exists companies_select_guide on public.companies;
create policy companies_select_guide on public.companies
for select to authenticated
using (public.is_guide_for(public.companies.id));

-- ---- quarters -----------------------------------------------
drop policy if exists quarters_select_guide on public.quarters;
create policy quarters_select_guide on public.quarters
for select to authenticated
using (public.is_guide_for(public.quarters.company_id));

drop policy if exists quarters_insert_guide on public.quarters;
create policy quarters_insert_guide on public.quarters
for insert to authenticated
with check (public.is_guide_for(public.quarters.company_id));

drop policy if exists quarters_update_guide on public.quarters;
create policy quarters_update_guide on public.quarters
for update to authenticated
using (public.is_guide_for(public.quarters.company_id))
with check (public.is_guide_for(public.quarters.company_id));

drop policy if exists quarters_delete_guide on public.quarters;
create policy quarters_delete_guide on public.quarters
for delete to authenticated
using (public.is_guide_for(public.quarters.company_id));

-- ---- priorities ---------------------------------------------
drop policy if exists priorities_select_guide on public.priorities;
create policy priorities_select_guide on public.priorities
for select to authenticated
using (public.is_guide_for(public.priorities.company_id));

drop policy if exists priorities_insert_guide on public.priorities;
create policy priorities_insert_guide on public.priorities
for insert to authenticated
with check (public.is_guide_for(public.priorities.company_id));

drop policy if exists priorities_update_guide on public.priorities;
create policy priorities_update_guide on public.priorities
for update to authenticated
using (public.is_guide_for(public.priorities.company_id))
with check (public.is_guide_for(public.priorities.company_id));

drop policy if exists priorities_delete_guide on public.priorities;
create policy priorities_delete_guide on public.priorities
for delete to authenticated
using (public.is_guide_for(public.priorities.company_id));

-- ---- commitments --------------------------------------------
drop policy if exists commitments_select_guide on public.commitments;
create policy commitments_select_guide on public.commitments
for select to authenticated
using (public.is_guide_for(public.commitments.company_id));

drop policy if exists commitments_insert_guide on public.commitments;
create policy commitments_insert_guide on public.commitments
for insert to authenticated
with check (public.is_guide_for(public.commitments.company_id));

drop policy if exists commitments_update_guide on public.commitments;
create policy commitments_update_guide on public.commitments
for update to authenticated
using (public.is_guide_for(public.commitments.company_id))
with check (public.is_guide_for(public.commitments.company_id));

drop policy if exists commitments_delete_guide on public.commitments;
create policy commitments_delete_guide on public.commitments
for delete to authenticated
using (public.is_guide_for(public.commitments.company_id));

-- ---- foundation ---------------------------------------------
drop policy if exists company_foundation_select_guide on public.company_foundation;
create policy company_foundation_select_guide on public.company_foundation
for select to authenticated
using (public.is_guide_for(public.company_foundation.company_id));

drop policy if exists company_foundation_insert_guide on public.company_foundation;
create policy company_foundation_insert_guide on public.company_foundation
for insert to authenticated
with check (public.is_guide_for(public.company_foundation.company_id));

drop policy if exists company_foundation_update_guide on public.company_foundation;
create policy company_foundation_update_guide on public.company_foundation
for update to authenticated
using (public.is_guide_for(public.company_foundation.company_id))
with check (public.is_guide_for(public.company_foundation.company_id));

drop policy if exists company_foundation_delete_guide on public.company_foundation;
create policy company_foundation_delete_guide on public.company_foundation
for delete to authenticated
using (public.is_guide_for(public.company_foundation.company_id));

drop policy if exists foundation_items_select_guide on public.foundation_items;
create policy foundation_items_select_guide on public.foundation_items
for select to authenticated
using (public.is_guide_for(public.foundation_items.company_id));

drop policy if exists foundation_items_insert_guide on public.foundation_items;
create policy foundation_items_insert_guide on public.foundation_items
for insert to authenticated
with check (public.is_guide_for(public.foundation_items.company_id));

drop policy if exists foundation_items_update_guide on public.foundation_items;
create policy foundation_items_update_guide on public.foundation_items
for update to authenticated
using (public.is_guide_for(public.foundation_items.company_id))
with check (public.is_guide_for(public.foundation_items.company_id));

drop policy if exists foundation_items_delete_guide on public.foundation_items;
create policy foundation_items_delete_guide on public.foundation_items
for delete to authenticated
using (public.is_guide_for(public.foundation_items.company_id));

-- ---- company_features ---------------------------------------
-- Sysadmin only historically; guides skip these (feature toggles
-- stay a platform-level decision).

-- ---- transcripts --------------------------------------------
drop policy if exists transcript_sources_select_guide on public.transcript_sources;
create policy transcript_sources_select_guide on public.transcript_sources
for select to authenticated
using (
  public.transcript_sources.company_id is not null
  and public.is_guide_for(public.transcript_sources.company_id)
);

drop policy if exists transcript_sources_insert_guide on public.transcript_sources;
create policy transcript_sources_insert_guide on public.transcript_sources
for insert to authenticated
with check (
  public.transcript_sources.company_id is not null
  and public.is_guide_for(public.transcript_sources.company_id)
);

drop policy if exists transcript_sources_update_guide on public.transcript_sources;
create policy transcript_sources_update_guide on public.transcript_sources
for update to authenticated
using (
  public.transcript_sources.company_id is not null
  and public.is_guide_for(public.transcript_sources.company_id)
)
with check (
  public.transcript_sources.company_id is not null
  and public.is_guide_for(public.transcript_sources.company_id)
);

drop policy if exists transcript_sources_delete_guide on public.transcript_sources;
create policy transcript_sources_delete_guide on public.transcript_sources
for delete to authenticated
using (
  public.transcript_sources.company_id is not null
  and public.is_guide_for(public.transcript_sources.company_id)
);

drop policy if exists transcript_aliases_select_guide on public.transcript_aliases;
create policy transcript_aliases_select_guide on public.transcript_aliases
for select to authenticated
using (public.is_guide_for(public.transcript_aliases.company_id));

drop policy if exists transcript_aliases_insert_guide on public.transcript_aliases;
create policy transcript_aliases_insert_guide on public.transcript_aliases
for insert to authenticated
with check (public.is_guide_for(public.transcript_aliases.company_id));

drop policy if exists transcript_aliases_update_guide on public.transcript_aliases;
create policy transcript_aliases_update_guide on public.transcript_aliases
for update to authenticated
using (public.is_guide_for(public.transcript_aliases.company_id))
with check (public.is_guide_for(public.transcript_aliases.company_id));

drop policy if exists transcript_aliases_delete_guide on public.transcript_aliases;
create policy transcript_aliases_delete_guide on public.transcript_aliases
for delete to authenticated
using (public.is_guide_for(public.transcript_aliases.company_id));

drop policy if exists meetings_select_guide on public.meetings;
create policy meetings_select_guide on public.meetings
for select to authenticated
using (
  public.meetings.company_id is not null
  and public.is_guide_for(public.meetings.company_id)
);

drop policy if exists meetings_update_guide on public.meetings;
create policy meetings_update_guide on public.meetings
for update to authenticated
using (
  public.meetings.company_id is not null
  and public.is_guide_for(public.meetings.company_id)
)
with check (
  public.meetings.company_id is not null
  and public.is_guide_for(public.meetings.company_id)
);

drop policy if exists meeting_analyses_select_guide on public.meeting_analyses;
create policy meeting_analyses_select_guide on public.meeting_analyses
for select to authenticated
using (
  exists (
    select 1 from public.meetings m
    where m.id = public.meeting_analyses.meeting_id
      and m.company_id is not null
      and public.is_guide_for(m.company_id)
  )
);

-- ---- oauth_credentials --------------------------------------
-- Guides can read the connection state for their assigned companies
-- so the UI can show "Reading Drive as X". Writes still go through
-- the service role via the callback route.
drop policy if exists oauth_credentials_select_guide on public.oauth_credentials;
create policy oauth_credentials_select_guide on public.oauth_credentials
for select to authenticated
using (public.is_guide_for(public.oauth_credentials.company_id));

-- ---- scorecard ---------------------------------------------
drop policy if exists scorecard_metrics_select_guide on public.scorecard_metrics;
create policy scorecard_metrics_select_guide on public.scorecard_metrics
for select to authenticated
using (public.is_guide_for(public.scorecard_metrics.company_id));

drop policy if exists scorecard_metrics_insert_guide on public.scorecard_metrics;
create policy scorecard_metrics_insert_guide on public.scorecard_metrics
for insert to authenticated
with check (public.is_guide_for(public.scorecard_metrics.company_id));

drop policy if exists scorecard_metrics_update_guide on public.scorecard_metrics;
create policy scorecard_metrics_update_guide on public.scorecard_metrics
for update to authenticated
using (public.is_guide_for(public.scorecard_metrics.company_id))
with check (public.is_guide_for(public.scorecard_metrics.company_id));

drop policy if exists scorecard_metrics_delete_guide on public.scorecard_metrics;
create policy scorecard_metrics_delete_guide on public.scorecard_metrics
for delete to authenticated
using (public.is_guide_for(public.scorecard_metrics.company_id));

drop policy if exists scorecard_entries_select_guide on public.scorecard_entries;
create policy scorecard_entries_select_guide on public.scorecard_entries
for select to authenticated
using (
  exists (
    select 1 from public.scorecard_metrics m
    where m.id = public.scorecard_entries.metric_id
      and public.is_guide_for(m.company_id)
  )
);

drop policy if exists scorecard_entries_insert_guide on public.scorecard_entries;
create policy scorecard_entries_insert_guide on public.scorecard_entries
for insert to authenticated
with check (
  exists (
    select 1 from public.scorecard_metrics m
    where m.id = public.scorecard_entries.metric_id
      and public.is_guide_for(m.company_id)
  )
);

drop policy if exists scorecard_entries_update_guide on public.scorecard_entries;
create policy scorecard_entries_update_guide on public.scorecard_entries
for update to authenticated
using (
  exists (
    select 1 from public.scorecard_metrics m
    where m.id = public.scorecard_entries.metric_id
      and public.is_guide_for(m.company_id)
  )
)
with check (
  exists (
    select 1 from public.scorecard_metrics m
    where m.id = public.scorecard_entries.metric_id
      and public.is_guide_for(m.company_id)
  )
);

drop policy if exists scorecard_entries_delete_guide on public.scorecard_entries;
create policy scorecard_entries_delete_guide on public.scorecard_entries
for delete to authenticated
using (
  exists (
    select 1 from public.scorecard_metrics m
    where m.id = public.scorecard_entries.metric_id
      and public.is_guide_for(m.company_id)
  )
);

-- ---- chart / functional areas -------------------------------
drop policy if exists functional_areas_select_guide on public.functional_areas;
create policy functional_areas_select_guide on public.functional_areas
for select to authenticated
using (public.is_guide_for(public.functional_areas.company_id));

drop policy if exists functional_areas_insert_guide on public.functional_areas;
create policy functional_areas_insert_guide on public.functional_areas
for insert to authenticated
with check (public.is_guide_for(public.functional_areas.company_id));

drop policy if exists functional_areas_update_guide on public.functional_areas;
create policy functional_areas_update_guide on public.functional_areas
for update to authenticated
using (public.is_guide_for(public.functional_areas.company_id))
with check (public.is_guide_for(public.functional_areas.company_id));

drop policy if exists functional_areas_delete_guide on public.functional_areas;
create policy functional_areas_delete_guide on public.functional_areas
for delete to authenticated
using (public.is_guide_for(public.functional_areas.company_id));

drop policy if exists functions_select_guide on public.functions;
create policy functions_select_guide on public.functions
for select to authenticated
using (public.is_guide_for(public.functions.company_id));

drop policy if exists functions_insert_guide on public.functions;
create policy functions_insert_guide on public.functions
for insert to authenticated
with check (public.is_guide_for(public.functions.company_id));

drop policy if exists functions_update_guide on public.functions;
create policy functions_update_guide on public.functions
for update to authenticated
using (public.is_guide_for(public.functions.company_id))
with check (public.is_guide_for(public.functions.company_id));

drop policy if exists functions_delete_guide on public.functions;
create policy functions_delete_guide on public.functions
for delete to authenticated
using (public.is_guide_for(public.functions.company_id));

drop policy if exists function_roles_select_guide on public.function_roles;
create policy function_roles_select_guide on public.function_roles
for select to authenticated
using (
  exists (
    select 1 from public.functions f
    where f.id = public.function_roles.function_id
      and public.is_guide_for(f.company_id)
  )
);

drop policy if exists function_roles_insert_guide on public.function_roles;
create policy function_roles_insert_guide on public.function_roles
for insert to authenticated
with check (
  exists (
    select 1 from public.functions f
    where f.id = public.function_roles.function_id
      and public.is_guide_for(f.company_id)
  )
);

drop policy if exists function_roles_update_guide on public.function_roles;
create policy function_roles_update_guide on public.function_roles
for update to authenticated
using (
  exists (
    select 1 from public.functions f
    where f.id = public.function_roles.function_id
      and public.is_guide_for(f.company_id)
  )
)
with check (
  exists (
    select 1 from public.functions f
    where f.id = public.function_roles.function_id
      and public.is_guide_for(f.company_id)
  )
);

drop policy if exists function_roles_delete_guide on public.function_roles;
create policy function_roles_delete_guide on public.function_roles
for delete to authenticated
using (
  exists (
    select 1 from public.functions f
    where f.id = public.function_roles.function_id
      and public.is_guide_for(f.company_id)
  )
);

drop policy if exists function_outcomes_select_guide on public.function_outcomes;
create policy function_outcomes_select_guide on public.function_outcomes
for select to authenticated
using (
  exists (
    select 1 from public.functions f
    where f.id = public.function_outcomes.function_id
      and public.is_guide_for(f.company_id)
  )
);

drop policy if exists function_outcomes_write_guide on public.function_outcomes;
create policy function_outcomes_write_guide on public.function_outcomes
for all to authenticated
using (
  exists (
    select 1 from public.functions f
    where f.id = public.function_outcomes.function_id
      and public.is_guide_for(f.company_id)
  )
)
with check (
  exists (
    select 1 from public.functions f
    where f.id = public.function_outcomes.function_id
      and public.is_guide_for(f.company_id)
  )
);

-- ---- Strategic focus areas / annual goals / success measures / marketing / one-page-plan
drop policy if exists strategic_focus_areas_select_guide on public.strategic_focus_areas;
create policy strategic_focus_areas_select_guide on public.strategic_focus_areas
for select to authenticated
using (public.is_guide_for(public.strategic_focus_areas.company_id));

drop policy if exists strategic_focus_areas_insert_guide on public.strategic_focus_areas;
create policy strategic_focus_areas_insert_guide on public.strategic_focus_areas
for insert to authenticated
with check (public.is_guide_for(public.strategic_focus_areas.company_id));

drop policy if exists strategic_focus_areas_update_guide on public.strategic_focus_areas;
create policy strategic_focus_areas_update_guide on public.strategic_focus_areas
for update to authenticated
using (public.is_guide_for(public.strategic_focus_areas.company_id))
with check (public.is_guide_for(public.strategic_focus_areas.company_id));

drop policy if exists strategic_focus_areas_delete_guide on public.strategic_focus_areas;
create policy strategic_focus_areas_delete_guide on public.strategic_focus_areas
for delete to authenticated
using (public.is_guide_for(public.strategic_focus_areas.company_id));

drop policy if exists annual_goals_select_guide on public.annual_goals;
create policy annual_goals_select_guide on public.annual_goals
for select to authenticated
using (public.is_guide_for(public.annual_goals.company_id));

drop policy if exists annual_goals_insert_guide on public.annual_goals;
create policy annual_goals_insert_guide on public.annual_goals
for insert to authenticated
with check (public.is_guide_for(public.annual_goals.company_id));

drop policy if exists annual_goals_update_guide on public.annual_goals;
create policy annual_goals_update_guide on public.annual_goals
for update to authenticated
using (public.is_guide_for(public.annual_goals.company_id))
with check (public.is_guide_for(public.annual_goals.company_id));

drop policy if exists annual_goals_delete_guide on public.annual_goals;
create policy annual_goals_delete_guide on public.annual_goals
for delete to authenticated
using (public.is_guide_for(public.annual_goals.company_id));

-- success_measures + success_measure_entries live under
-- function_outcomes → functions.company_id (no direct company_id
-- column). Traverse the chain to authorise.
drop policy if exists success_measures_select_guide on public.success_measures;
create policy success_measures_select_guide on public.success_measures
for select to authenticated
using (
  exists (
    select 1
    from public.function_outcomes fo
    join public.functions f on f.id = fo.function_id
    where fo.id = public.success_measures.outcome_id
      and public.is_guide_for(f.company_id)
  )
);

drop policy if exists success_measures_write_guide on public.success_measures;
create policy success_measures_write_guide on public.success_measures
for all to authenticated
using (
  exists (
    select 1
    from public.function_outcomes fo
    join public.functions f on f.id = fo.function_id
    where fo.id = public.success_measures.outcome_id
      and public.is_guide_for(f.company_id)
  )
)
with check (
  exists (
    select 1
    from public.function_outcomes fo
    join public.functions f on f.id = fo.function_id
    where fo.id = public.success_measures.outcome_id
      and public.is_guide_for(f.company_id)
  )
);

drop policy if exists success_measure_entries_select_guide on public.success_measure_entries;
create policy success_measure_entries_select_guide on public.success_measure_entries
for select to authenticated
using (
  exists (
    select 1
    from public.success_measures sm
    join public.function_outcomes fo on fo.id = sm.outcome_id
    join public.functions f on f.id = fo.function_id
    where sm.id = public.success_measure_entries.measure_id
      and public.is_guide_for(f.company_id)
  )
);

drop policy if exists success_measure_entries_write_guide on public.success_measure_entries;
create policy success_measure_entries_write_guide on public.success_measure_entries
for all to authenticated
using (
  exists (
    select 1
    from public.success_measures sm
    join public.function_outcomes fo on fo.id = sm.outcome_id
    join public.functions f on f.id = fo.function_id
    where sm.id = public.success_measure_entries.measure_id
      and public.is_guide_for(f.company_id)
  )
)
with check (
  exists (
    select 1
    from public.success_measures sm
    join public.function_outcomes fo on fo.id = sm.outcome_id
    join public.functions f on f.id = fo.function_id
    where sm.id = public.success_measure_entries.measure_id
      and public.is_guide_for(f.company_id)
  )
);

drop policy if exists marketing_strategy_select_guide on public.marketing_strategy;
create policy marketing_strategy_select_guide on public.marketing_strategy
for select to authenticated
using (public.is_guide_for(public.marketing_strategy.company_id));

drop policy if exists marketing_strategy_insert_guide on public.marketing_strategy;
create policy marketing_strategy_insert_guide on public.marketing_strategy
for insert to authenticated
with check (public.is_guide_for(public.marketing_strategy.company_id));

drop policy if exists marketing_strategy_update_guide on public.marketing_strategy;
create policy marketing_strategy_update_guide on public.marketing_strategy
for update to authenticated
using (public.is_guide_for(public.marketing_strategy.company_id))
with check (public.is_guide_for(public.marketing_strategy.company_id));

drop policy if exists marketing_strategy_delete_guide on public.marketing_strategy;
create policy marketing_strategy_delete_guide on public.marketing_strategy
for delete to authenticated
using (public.is_guide_for(public.marketing_strategy.company_id));

drop policy if exists marketing_snippets_select_guide on public.marketing_snippets;
create policy marketing_snippets_select_guide on public.marketing_snippets
for select to authenticated
using (public.is_guide_for(public.marketing_snippets.company_id));

drop policy if exists marketing_snippets_insert_guide on public.marketing_snippets;
create policy marketing_snippets_insert_guide on public.marketing_snippets
for insert to authenticated
with check (public.is_guide_for(public.marketing_snippets.company_id));

drop policy if exists marketing_snippets_update_guide on public.marketing_snippets;
create policy marketing_snippets_update_guide on public.marketing_snippets
for update to authenticated
using (public.is_guide_for(public.marketing_snippets.company_id))
with check (public.is_guide_for(public.marketing_snippets.company_id));

drop policy if exists marketing_snippets_delete_guide on public.marketing_snippets;
create policy marketing_snippets_delete_guide on public.marketing_snippets
for delete to authenticated
using (public.is_guide_for(public.marketing_snippets.company_id));

drop policy if exists messaging_pillars_select_guide on public.messaging_pillars;
create policy messaging_pillars_select_guide on public.messaging_pillars
for select to authenticated
using (public.is_guide_for(public.messaging_pillars.company_id));

drop policy if exists messaging_pillars_insert_guide on public.messaging_pillars;
create policy messaging_pillars_insert_guide on public.messaging_pillars
for insert to authenticated
with check (public.is_guide_for(public.messaging_pillars.company_id));

drop policy if exists messaging_pillars_update_guide on public.messaging_pillars;
create policy messaging_pillars_update_guide on public.messaging_pillars
for update to authenticated
using (public.is_guide_for(public.messaging_pillars.company_id))
with check (public.is_guide_for(public.messaging_pillars.company_id));

drop policy if exists messaging_pillars_delete_guide on public.messaging_pillars;
create policy messaging_pillars_delete_guide on public.messaging_pillars
for delete to authenticated
using (public.is_guide_for(public.messaging_pillars.company_id));

-- ---- dashboard_ai_briefs -----------------------------------
drop policy if exists dashboard_ai_briefs_select_guide on public.dashboard_ai_briefs;
create policy dashboard_ai_briefs_select_guide on public.dashboard_ai_briefs
for select to authenticated
using (public.is_guide_for(public.dashboard_ai_briefs.company_id));

drop policy if exists dashboard_ai_briefs_insert_guide on public.dashboard_ai_briefs;
create policy dashboard_ai_briefs_insert_guide on public.dashboard_ai_briefs
for insert to authenticated
with check (public.is_guide_for(public.dashboard_ai_briefs.company_id));

-- ---- Strengths / coaching intentionally OMITTED ------------
-- These are personal / private surfaces:
--   * user_strengths + strengths_* — self-assessment data. A guide
--     accesses the same read paths through profile visibility; if
--     coaching wants team-level strengths, we'll widen explicitly.
--   * coaching_conversations / coaching_messages — privacy model
--     already restricts to created_by = auth.uid(). Guides never
--     see another admin's coaching threads.
--   * ask_aimee — personal chat surface, same rationale.
