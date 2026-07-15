-- =============================================================
-- Phase 7 — Migration 0013: cached AI briefs for the dashboard.
--   One row per company per calendar day (in the company's own
--   timezone, so a brief that renders for "today" doesn't spuriously
--   invalidate at UTC midnight). Any admin viewing the dashboard
--   reads the row; the first one to hit the page each day writes it.
--
--   Kept intentionally simple: no history table, no versioning. The
--   day-level unique index doubles as the cache key.
-- =============================================================

create table public.dashboard_ai_briefs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  brief_date date not null,
  content text not null,
  generated_at timestamptz not null default now(),
  generated_by uuid references public.profiles(id) on delete set null,
  unique (company_id, brief_date)
);

create index dashboard_ai_briefs_by_company_idx
  on public.dashboard_ai_briefs (company_id, brief_date desc);

-- =============================================================
-- RLS
--   Read: company_admin / system_admin scoped to the company row.
--   Write: same. The server-side dashboard loader runs under the
--   admin's session and inserts on first-of-day cache miss.
-- =============================================================
alter table public.dashboard_ai_briefs enable row level security;
alter table public.dashboard_ai_briefs force row level security;

create policy dashboard_ai_briefs_select on public.dashboard_ai_briefs
for select to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role in ('company_admin','system_admin')
      and (
        ap.role = 'system_admin'
        or ap.company_id = public.dashboard_ai_briefs.company_id
      )
  )
);

create policy dashboard_ai_briefs_insert on public.dashboard_ai_briefs
for insert to authenticated
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role in ('company_admin','system_admin')
      and (
        ap.role = 'system_admin'
        or ap.company_id = public.dashboard_ai_briefs.company_id
      )
  )
);
