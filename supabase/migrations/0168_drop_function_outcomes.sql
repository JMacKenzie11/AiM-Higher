-- Retire the outcome table.
--
-- Migration 0166 promoted every function_outcome into a critical
-- success factor row in success_measures and left both in place so
-- reads could move over one surface at a time. That transition is
-- finished: nothing in the application writes function_outcomes or
-- reads success_measures.outcome_id any more.
--
-- Two things go:
--
--   success_measures.outcome_id  — a KPI's parent now lives in
--                                  csf_kpi_links, which is
--                                  many-to-many by design.
--   function_outcomes            — the table itself.
--
-- Order matters. The column has a foreign key into the table, so it
-- has to go first or the drop fails on a dependency. Four policies on
-- success_measure_entries also read it and are rewritten below, both
-- to clear the drop and to fix a bug they carry (see section 1b).
--
-- This is not reversible from data still in the database: once the
-- table is gone the pairing survives only in csf_kpi_links, which
-- 0166 populated from exactly this data. Restoring means restoring
-- from a backup, which is why 0166 and 0168 are separate migrations
-- with the application change between them.

-- ---- 1. Policies that read outcome_id ------------------------
--
-- 0166 added function_id-keyed policies on success_measures
-- alongside the originals. The originals join through outcome_id, so
-- they go before the column can be dropped. Their replacements are
-- already live.

drop policy if exists success_measures_select on public.success_measures;
drop policy if exists success_measures_write on public.success_measures;
drop policy if exists success_measures_select_guide on public.success_measures;
drop policy if exists success_measures_write_guide on public.success_measures;

-- ---- 1b. The entries policies 0166 missed --------------------
--
-- These four were not mirrored in 0166, and they are the reason the
-- column drop fails. Every one of them reaches a company through
--
--     success_measures -> function_outcomes -> functions
--
-- which has two consequences. The obvious one is the dependency
-- blocking the drop.
--
-- The other is a live bug. On a critical success factor outcome_id
-- is NULL, so that join matches nothing and every one of these
-- policies denies. There is no fifth policy to pick up the slack:
-- these four are the whole policy set on the table. So since 0166,
-- writing a weekly value against a CSF has been rejected by RLS for
-- every role including system_admin.
--
-- It is not silent, and it is worse than a lost CSF value. The
-- measures page upserts a whole function in one batch, so the denied
-- CSF row fails the statement and takes that function's KPI values
-- down with it. The leader sees a raw row-level-security message and
-- none of their numbers saved.
--
-- The CSF value input only landed on 2026-09-04, so the window is
-- roughly a day. Rewriting these against function_id fixes the drop
-- and the bug in one statement, since function_id is set on measures
-- of both kinds.

drop policy if exists success_measure_entries_select on public.success_measure_entries;
create policy success_measure_entries_select on public.success_measure_entries
for select to authenticated
using (
  exists (
    select 1
    from public.success_measures m
    join public.functions f on f.id = m.function_id
    join public.auth_profile() ap on true
    where m.id = public.success_measure_entries.measure_id
      and (ap.role = 'system_admin'
           or (ap.company_id is not null and ap.company_id = f.company_id))
  )
);

drop policy if exists success_measure_entries_write on public.success_measure_entries;
create policy success_measure_entries_write on public.success_measure_entries
for all to authenticated
using (
  exists (
    select 1
    from public.success_measures m
    join public.functions f on f.id = m.function_id
    join public.auth_profile() ap on true
    where m.id = public.success_measure_entries.measure_id
      and (ap.role = 'system_admin'
           or (ap.role = 'company_admin' and ap.company_id = f.company_id)
           or f.lead_id = ap.uid
           or f.track_id = ap.uid)
  )
)
with check (
  exists (
    select 1
    from public.success_measures m
    join public.functions f on f.id = m.function_id
    join public.auth_profile() ap on true
    where m.id = public.success_measure_entries.measure_id
      and (ap.role = 'system_admin'
           or (ap.role = 'company_admin' and ap.company_id = f.company_id)
           or f.lead_id = ap.uid
           or f.track_id = ap.uid)
  )
);

drop policy if exists success_measure_entries_select_guide on public.success_measure_entries;
create policy success_measure_entries_select_guide on public.success_measure_entries
for select to authenticated
using (
  exists (
    select 1
    from public.success_measures sm
    join public.functions f on f.id = sm.function_id
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
    join public.functions f on f.id = sm.function_id
    where sm.id = public.success_measure_entries.measure_id
      and public.is_guide_for(f.company_id)
  )
)
with check (
  exists (
    select 1
    from public.success_measures sm
    join public.functions f on f.id = sm.function_id
    where sm.id = public.success_measure_entries.measure_id
      and public.is_guide_for(f.company_id)
  )
);

-- ---- 2. The column -------------------------------------------

drop index if exists success_measures_outcome_id_idx;

alter table public.success_measures
  drop column if exists outcome_id;

-- ---- 3. The table --------------------------------------------

drop table if exists public.function_outcomes cascade;

-- ---- 4. function_id is required now --------------------------
--
-- Every measure of either kind reaches its company through this
-- column. 0166 backfilled it and every write since has set it, so
-- the constraint records what is already true and stops a future
-- write from creating a row no policy can see.

alter table public.success_measures
  alter column function_id set not null;
