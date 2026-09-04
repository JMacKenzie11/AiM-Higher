-- =============================================================
-- Migration 0166: CSF / KPI model, additive only.
--
-- Phase 2 of the migration. Nothing is dropped and nothing that
-- exists today changes meaning. After this runs, both models are
-- valid at once: every current read path keeps working through
-- outcome_id, and the new shape sits alongside it unread until
-- phase 3 moves the read paths over.
--
-- Target shape: one measures table holding both kinds, joined by a
-- many-to-many link table.
--
--   success_measures.kind = 'csf'  → a Critical Success Factor,
--       the lagging result a function is accountable for
--   success_measures.kind = 'kpi'  → a Key Performance Indicator,
--       the leading activity that moves a CSF
--   csf_kpi_links                  → which KPIs drive which CSF
--
-- The link table is many-to-many by design even though the UI will
-- enforce one CSF per KPI for now. No unique constraint on kpi_id:
-- that would contradict the reason for building the link table and
-- someone would have to remember to drop it later.
-- =============================================================

-- ---- 1. New columns ----------------------------------------
alter table public.success_measures
  add column if not exists kind text not null default 'kpi'
    check (kind in ('csf','kpi')),
  -- Every measure hangs off a function directly. Populated for
  -- existing rows below; required in the target model, left
  -- nullable here because both models must be valid at once.
  add column if not exists function_id uuid
    references public.functions(id) on delete cascade,
  -- Outcomes carry BOTH a title and a longer description. Measures
  -- only have `description`, which holds the name. Without this
  -- column the outcome's descriptive text would be dropped on the
  -- floor during the backfill below, which is real data loss on a
  -- field the current UI renders (OutcomeSection.outcomeDescription).
  add column if not exists detail text;

-- A CSF has no parent outcome. Widening this is safe: every
-- existing row keeps its value, and no current read path can be
-- broken by a column becoming more permissive.
alter table public.success_measures
  alter column outcome_id drop not null;

create index if not exists success_measures_function_kind_idx
  on public.success_measures (function_id, kind)
  where archived = false;

-- ---- 2. Backfill function_id on existing KPI rows -----------
update public.success_measures m
   set function_id = o.function_id
  from public.function_outcomes o
 where o.id = m.outcome_id
   and m.function_id is null;

-- ---- 3. Promote every outcome to a CSF measure --------------
-- The outcome's id is REUSED as the measure id. That is deliberate:
-- anything already pointing at an outcome id (a /measures deep link,
-- a role-description reference, a chart anchor) keeps resolving, and
-- it makes the link backfill in step 5 a straight join with no
-- lookup table.
--
-- auto_track is forced FALSE on migrated CSFs. The performance cron
-- opens a "log this week's value" commitment for every auto_track
-- measure with no entry, so defaulting these to true would hand every
-- function leader a pile of new weekly commitments the moment the
-- cron is restored in phase 6. Leaders opt in per CSF instead.
insert into public.success_measures
  (id, outcome_id, function_id, kind, description, detail,
   sort_order, archived, auto_track, created_at, updated_at)
select
  o.id,
  null,               -- a CSF has no parent outcome
  o.function_id,
  'csf',
  o.title,            -- the outcome's name becomes the measure name
  o.description,      -- and its longer text lands in detail
  o.sort_order,
  o.archived,
  false,
  o.created_at,
  o.updated_at
from public.function_outcomes o
on conflict (id) do nothing;

-- ---- 4. The link table --------------------------------------
create table if not exists public.csf_kpi_links (
  csf_id uuid not null references public.success_measures(id) on delete cascade,
  kpi_id uuid not null references public.success_measures(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (csf_id, kpi_id),
  -- A measure cannot drive itself.
  constraint csf_kpi_links_no_self check (csf_id <> kpi_id)
);

-- Reverse lookup: "which CSFs does this KPI drive?" is the read the
-- UI does on every KPI row, and the PK only serves the forward one.
create index if not exists csf_kpi_links_kpi_idx
  on public.csf_kpi_links (kpi_id);

-- ---- 5. The old containment becomes the first link ----------
insert into public.csf_kpi_links (csf_id, kpi_id)
select m.outcome_id, m.id
  from public.success_measures m
 where m.kind = 'kpi'
   and m.outcome_id is not null
on conflict do nothing;

-- ---- 6. RLS on the link table -------------------------------
-- Company resolved through the CSF's function, mirroring the
-- success_measures policies. Same three audiences: system admins,
-- members of the owning company, and guides assigned to it.
alter table public.csf_kpi_links enable row level security;
alter table public.csf_kpi_links force row level security;

drop policy if exists csf_kpi_links_select on public.csf_kpi_links;
create policy csf_kpi_links_select on public.csf_kpi_links
for select to authenticated
using (
  exists (
    select 1
    from public.success_measures m
    join public.functions f on f.id = m.function_id
    join public.auth_profile() ap on true
    where m.id = public.csf_kpi_links.csf_id
      and (ap.role = 'system_admin'
           or (ap.company_id is not null and ap.company_id = f.company_id))
  )
);

drop policy if exists csf_kpi_links_write on public.csf_kpi_links;
create policy csf_kpi_links_write on public.csf_kpi_links
for all to authenticated
using (
  exists (
    select 1
    from public.success_measures m
    join public.functions f on f.id = m.function_id
    join public.auth_profile() ap on true
    where m.id = public.csf_kpi_links.csf_id
      and (ap.role = 'system_admin'
           or (ap.role = 'company_admin' and ap.company_id = f.company_id))
  )
)
with check (
  exists (
    select 1
    from public.success_measures m
    join public.functions f on f.id = m.function_id
    join public.auth_profile() ap on true
    where m.id = public.csf_kpi_links.csf_id
      and (ap.role = 'system_admin'
           or (ap.role = 'company_admin' and ap.company_id = f.company_id))
  )
);

drop policy if exists csf_kpi_links_select_guide on public.csf_kpi_links;
create policy csf_kpi_links_select_guide on public.csf_kpi_links
for select to authenticated
using (
  exists (
    select 1
    from public.success_measures m
    join public.functions f on f.id = m.function_id
    where m.id = public.csf_kpi_links.csf_id
      and public.is_guide_for(f.company_id)
  )
);

drop policy if exists csf_kpi_links_write_guide on public.csf_kpi_links;
create policy csf_kpi_links_write_guide on public.csf_kpi_links
for all to authenticated
using (
  exists (
    select 1
    from public.success_measures m
    join public.functions f on f.id = m.function_id
    where m.id = public.csf_kpi_links.csf_id
      and public.is_guide_for(f.company_id)
  )
)
with check (
  exists (
    select 1
    from public.success_measures m
    join public.functions f on f.id = m.function_id
    where m.id = public.csf_kpi_links.csf_id
      and public.is_guide_for(f.company_id)
  )
);

-- ---- 7. Measures reachable by function_id -------------------
-- REQUIRED, not optional. Every existing success_measures policy
-- resolves the company by joining through outcome_id. A CSF row has
-- outcome_id NULL, so without these it would be invisible to every
-- user role — the rows would exist and nothing but the service role
-- could see them. That would not show up until phase 3 started
-- reading them, and would look like missing data rather than a
-- policy gap.
--
-- Permissive policies OR together, so these are purely additive.
-- They cannot widen access beyond intent: function_id was backfilled
-- from the row's own outcome, so it resolves to the same company the
-- existing policies already allow.
drop policy if exists success_measures_select_by_function on public.success_measures;
create policy success_measures_select_by_function on public.success_measures
for select to authenticated
using (
  exists (
    select 1
    from public.functions f
    join public.auth_profile() ap on true
    where f.id = public.success_measures.function_id
      and (ap.role = 'system_admin'
           or (ap.company_id is not null and ap.company_id = f.company_id))
  )
);

drop policy if exists success_measures_write_by_function on public.success_measures;
create policy success_measures_write_by_function on public.success_measures
for all to authenticated
using (
  exists (
    select 1
    from public.functions f
    join public.auth_profile() ap on true
    where f.id = public.success_measures.function_id
      and (ap.role = 'system_admin'
           or (ap.role = 'company_admin' and ap.company_id = f.company_id))
  )
)
with check (
  exists (
    select 1
    from public.functions f
    join public.auth_profile() ap on true
    where f.id = public.success_measures.function_id
      and (ap.role = 'system_admin'
           or (ap.role = 'company_admin' and ap.company_id = f.company_id))
  )
);

drop policy if exists success_measures_select_by_function_guide on public.success_measures;
create policy success_measures_select_by_function_guide on public.success_measures
for select to authenticated
using (
  exists (
    select 1 from public.functions f
    where f.id = public.success_measures.function_id
      and public.is_guide_for(f.company_id)
  )
);

drop policy if exists success_measures_write_by_function_guide on public.success_measures;
create policy success_measures_write_by_function_guide on public.success_measures
for all to authenticated
using (
  exists (
    select 1 from public.functions f
    where f.id = public.success_measures.function_id
      and public.is_guide_for(f.company_id)
  )
)
with check (
  exists (
    select 1 from public.functions f
    where f.id = public.success_measures.function_id
      and public.is_guide_for(f.company_id)
  )
);

-- =============================================================
-- Known and deliberate: this migration adds rows to
-- success_measures, which changes what scoreMeasures would count IF
-- it found them. It does not, because it selects
-- `.in("outcome_id", outcomeIds)` and CSF rows have outcome_id NULL.
-- The Success Tracking score is therefore unchanged by this
-- migration. It WILL move in phase 3 when that scorer is rewired to
-- read by function and kind, because the denominator grows to
-- include CSFs. The characterisation tests added in phase 1 will
-- catch that; treat it as a decision to make, not a regression.
-- =============================================================
