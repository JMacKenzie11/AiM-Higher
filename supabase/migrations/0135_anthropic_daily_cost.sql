-- =============================================================
-- Migration 0135 — anthropic_daily_cost (real invoiced spend)
--
-- Populated by /api/cron/anthropic-cost, which hits the Anthropic
-- Admin API's cost_report endpoint filtered to the AiMHigher
-- workspace_id (env: ANTHROPIC_WORKSPACE_ID) and stores one row
-- per day. Anthropic returns cost as fractional cents so the
-- column is numeric — sum first, round only when displaying to
-- avoid a penny of drift on a 30-day rollup.
--
-- Read by the admin dashboard's "Coach spend" card in place of
-- the summed estimator on coach_token_usage. Per-company mini-bars
-- continue to use the estimator (Anthropic doesn't segment cost
-- by our companies, only by workspace).
--
-- Written by the admin client from server code; RLS restricts
-- reads to system_admin.
-- =============================================================

create table public.anthropic_daily_cost (
  bucket_date date primary key,
  amount_cents numeric not null,
  workspace_id text,
  fetched_at timestamptz not null default now()
);

create index anthropic_daily_cost_bucket_idx
  on public.anthropic_daily_cost (bucket_date desc);

alter table public.anthropic_daily_cost enable row level security;
alter table public.anthropic_daily_cost force row level security;

create policy anthropic_daily_cost_select on public.anthropic_daily_cost
for select to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
  )
);
