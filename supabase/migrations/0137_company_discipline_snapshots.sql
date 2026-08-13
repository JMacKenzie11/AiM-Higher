-- =============================================================
-- Migration 0137 — company_discipline_snapshots
--
-- Powers the AiMS Scorecard page (/scorecard). Each row is a weekly
-- snapshot of one discipline's score (0–10) for one company. The
-- current-week score is computed live on page load; the snapshots
-- give the trajectory line chart and the "vs 90 days ago" arrow.
--
-- Disciplines land under fixed keys — the scoring functions live in
-- src/lib/maturity/scorers/, one file per discipline. Adding a new
-- discipline is:
--   1. add the key to the CHECK constraint below,
--   2. add a scorer file,
--   3. add the key to DISCIPLINE_KEYS in src/lib/maturity/disciplines.ts.
--
-- Each snapshot also carries a breakdown_json so the UI can explain
-- why the score is what it is ("Kept rate 74%, aging opens 12, …").
-- Shape is discipline-specific; consumers key off `discipline` to
-- decide how to render it.
--
-- Access: any signed-in member of the company can read (transparency
-- is the whole point — team members see the same view leaders do).
-- Writes happen server-side via the admin client from the cron only.
-- =============================================================

create table public.company_discipline_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  snapshot_date date not null, -- YYYY-MM-DD in the company's timezone
  discipline text not null check (discipline in (
    'foundation',
    'chart',
    'planning',
    'execution',
    'measures',
    'meetings'
  )),
  -- 0–10 inclusive. Nullable so a feature-gated discipline can
  -- record "not applicable" without polluting the average.
  score numeric(3, 1) check (score is null or (score >= 0 and score <= 10)),
  breakdown_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  -- One snapshot per (company, date, discipline). The weekly cron
  -- upserts on this key so a manual re-run doesn't duplicate rows.
  unique (company_id, snapshot_date, discipline)
);

create index company_discipline_snapshots_lookup_idx
  on public.company_discipline_snapshots (company_id, snapshot_date desc);

alter table public.company_discipline_snapshots enable row level security;
alter table public.company_discipline_snapshots force row level security;

-- Everyone in the company can read. Guides mirror admins per
-- is_guide_for(). No insert / update policies — writes are admin-key
-- only from the cron path.
create policy company_discipline_snapshots_select
on public.company_discipline_snapshots for select
to authenticated
using (
  company_id = (select company_id from public.auth_profile())
  or public.is_guide_for(company_id)
  or exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
  )
);
