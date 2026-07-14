-- =============================================================
-- Phase 6 — Migration 0008: functional scorecard (Section 4.8).
--   functional_areas · scorecard_metrics · scorecard_entries
--   Entries can be inserted/updated by the area's accountable OR
--   any admin. Company members read everything.
-- =============================================================

-- ---- functional_areas ----------------------------------------
create table if not exists public.functional_areas (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  accountable_id uuid references public.profiles(id) on delete set null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists functional_areas_company_id_idx
  on public.functional_areas (company_id);
create index if not exists functional_areas_accountable_id_idx
  on public.functional_areas (accountable_id);

drop trigger if exists functional_areas_set_updated_at on public.functional_areas;
create trigger functional_areas_set_updated_at
before update on public.functional_areas
for each row execute function public.set_updated_at();

-- ---- scorecard_metrics ---------------------------------------
create table if not exists public.scorecard_metrics (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  functional_area_id uuid not null references public.functional_areas(id) on delete cascade,
  name text not null,
  target text,
  value_type text not null default 'number'
    check (value_type in ('number','percent','text')),
  sort_order int not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scorecard_metrics_company_id_idx
  on public.scorecard_metrics (company_id);
create index if not exists scorecard_metrics_area_id_idx
  on public.scorecard_metrics (functional_area_id);

drop trigger if exists scorecard_metrics_set_updated_at on public.scorecard_metrics;
create trigger scorecard_metrics_set_updated_at
before update on public.scorecard_metrics
for each row execute function public.set_updated_at();

-- ---- scorecard_entries ---------------------------------------
create table if not exists public.scorecard_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  metric_id uuid not null references public.scorecard_metrics(id) on delete cascade,
  week_ending date not null,
  value_number numeric,
  value_text text,
  entered_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (metric_id, week_ending)
);

create index if not exists scorecard_entries_metric_week_idx
  on public.scorecard_entries (metric_id, week_ending);
create index if not exists scorecard_entries_company_week_idx
  on public.scorecard_entries (company_id, week_ending);

drop trigger if exists scorecard_entries_set_updated_at on public.scorecard_entries;
create trigger scorecard_entries_set_updated_at
before update on public.scorecard_entries
for each row execute function public.set_updated_at();

-- =============================================================
-- RLS (Section 5)
-- =============================================================
alter table public.functional_areas  enable row level security;
alter table public.scorecard_metrics enable row level security;
alter table public.scorecard_entries enable row level security;

alter table public.functional_areas  force row level security;
alter table public.scorecard_metrics force row level security;
alter table public.scorecard_entries force row level security;

-- ---- functional_areas policies ----
drop policy if exists functional_areas_select on public.functional_areas;
create policy functional_areas_select on public.functional_areas
for select to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.company_id is not null and ap.company_id = public.functional_areas.company_id)
  )
);

drop policy if exists functional_areas_insert on public.functional_areas;
create policy functional_areas_insert on public.functional_areas
for insert to authenticated
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.functional_areas.company_id)
  )
);

drop policy if exists functional_areas_update on public.functional_areas;
create policy functional_areas_update on public.functional_areas
for update to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.functional_areas.company_id)
  )
)
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.functional_areas.company_id)
  )
);

drop policy if exists functional_areas_delete on public.functional_areas;
create policy functional_areas_delete on public.functional_areas
for delete to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.functional_areas.company_id)
  )
);

-- ---- scorecard_metrics policies ----
drop policy if exists scorecard_metrics_select on public.scorecard_metrics;
create policy scorecard_metrics_select on public.scorecard_metrics
for select to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.company_id is not null and ap.company_id = public.scorecard_metrics.company_id)
  )
);

drop policy if exists scorecard_metrics_insert on public.scorecard_metrics;
create policy scorecard_metrics_insert on public.scorecard_metrics
for insert to authenticated
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.scorecard_metrics.company_id)
  )
);

drop policy if exists scorecard_metrics_update on public.scorecard_metrics;
create policy scorecard_metrics_update on public.scorecard_metrics
for update to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.scorecard_metrics.company_id)
  )
)
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.scorecard_metrics.company_id)
  )
);

drop policy if exists scorecard_metrics_delete on public.scorecard_metrics;
create policy scorecard_metrics_delete on public.scorecard_metrics
for delete to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.scorecard_metrics.company_id)
  )
);

-- ---- scorecard_entries policies ----
-- Read: any company member.
drop policy if exists scorecard_entries_select on public.scorecard_entries;
create policy scorecard_entries_select on public.scorecard_entries
for select to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.company_id is not null and ap.company_id = public.scorecard_entries.company_id)
  )
);

-- Insert: admin OR the accountable person of the entry's metric's area.
--   The subquery to functional_areas is safe under RLS because the
--   caller is authenticated and the FA is scoped to their own company.
drop policy if exists scorecard_entries_insert on public.scorecard_entries;
create policy scorecard_entries_insert on public.scorecard_entries
for insert to authenticated
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.scorecard_entries.company_id)
       or exists (
         select 1
         from public.scorecard_metrics m
         join public.functional_areas fa on fa.id = m.functional_area_id
         where m.id = public.scorecard_entries.metric_id
           and fa.accountable_id = ap.uid
       )
  )
);

drop policy if exists scorecard_entries_update on public.scorecard_entries;
create policy scorecard_entries_update on public.scorecard_entries
for update to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.scorecard_entries.company_id)
       or exists (
         select 1
         from public.scorecard_metrics m
         join public.functional_areas fa on fa.id = m.functional_area_id
         where m.id = public.scorecard_entries.metric_id
           and fa.accountable_id = ap.uid
       )
  )
)
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.scorecard_entries.company_id)
       or exists (
         select 1
         from public.scorecard_metrics m
         join public.functional_areas fa on fa.id = m.functional_area_id
         where m.id = public.scorecard_entries.metric_id
           and fa.accountable_id = ap.uid
       )
  )
);

-- Delete: admins only (Section 5 matrix).
drop policy if exists scorecard_entries_delete on public.scorecard_entries;
create policy scorecard_entries_delete on public.scorecard_entries
for delete to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.scorecard_entries.company_id)
  )
);
