-- =============================================================
-- Migration 0134 — coach_theme_snapshot (nightly themes cache)
--
-- Stores the result of the nightly themes-clustering job. Each
-- run inserts a new row; the system-admin dashboard reads the
-- most recent by refreshed_at. History rows are kept so we can
-- eyeball drift across weeks without a separate audit table.
--
-- Themes shape (JSONB):
--   [
--     { "label": string, "count": int, "description": string }
--   ]
--
-- Written by src/app/api/cron/themes/route.ts, read by
-- src/lib/admin/dashboard-service.ts. Both use the admin client
-- server-side; the RLS policy exists only so a curious
-- system-admin's browser session can also read directly (belt
-- and braces).
-- =============================================================

create table public.coach_theme_snapshot (
  id uuid primary key default gen_random_uuid(),
  themes jsonb not null,
  source_count int not null default 0,
  model text,
  refreshed_at timestamptz not null default now()
);

create index coach_theme_snapshot_refreshed_idx
  on public.coach_theme_snapshot (refreshed_at desc);

alter table public.coach_theme_snapshot enable row level security;
alter table public.coach_theme_snapshot force row level security;

create policy coach_theme_snapshot_select on public.coach_theme_snapshot
for select to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
  )
);
