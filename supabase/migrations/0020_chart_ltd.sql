-- =============================================================
-- Migration 0020: LTD (Lead / Track / Decide) roles on functions.
--
-- 0019 landed with a single `leader_id` — the person accountable
-- for the function. In practice we split accountability three ways:
--   Lead   — the person who owns the function's direction (usually
--            the same as the previous leader_id)
--   Track  — the person who keeps the numbers (often the same, but
--            can be a controller/analyst for finance-heavy work)
--   Decide — the person with authority to make the call when the
--            numbers say something is off (often escalates to the
--            owner or a VP)
--
-- All three are nullable and the app falls back to `leader_id`
-- when a role isn't explicitly set, so existing rows keep rendering
-- without a data migration.
--
-- Also: rename leader_id → lead_id at the same time to match the
-- LTD language. lead_id is the source of truth for the "L" role.
-- =============================================================

alter table public.functions
  rename column leader_id to lead_id;

alter table public.functions
  add column if not exists track_id  uuid references public.profiles(id) on delete set null,
  add column if not exists decide_id uuid references public.profiles(id) on delete set null;

-- Existing RLS policy on success_measure_entries referenced
-- functions.leader_id — recreate it against lead_id.
drop policy if exists success_measure_entries_write on public.success_measure_entries;
create policy success_measure_entries_write on public.success_measure_entries
for all to authenticated
using (
  exists (
    select 1
    from public.success_measures m
    join public.function_outcomes o on o.id = m.outcome_id
    join public.functions f on f.id = o.function_id
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
    join public.function_outcomes o on o.id = m.outcome_id
    join public.functions f on f.id = o.function_id
    join public.auth_profile() ap on true
    where m.id = public.success_measure_entries.measure_id
      and (ap.role = 'system_admin'
           or (ap.role = 'company_admin' and ap.company_id = f.company_id)
           or f.lead_id = ap.uid
           or f.track_id = ap.uid)
  )
);

-- Reindex leader → lead.
drop index if exists functions_leader_idx;
create index if not exists functions_lead_idx on public.functions (lead_id);
create index if not exists functions_track_idx on public.functions (track_id);
create index if not exists functions_decide_idx on public.functions (decide_id);
