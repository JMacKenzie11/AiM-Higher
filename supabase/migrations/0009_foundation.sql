-- =============================================================
-- Phase 7 — Migration 0009: company foundation + marketing strategy
--   Section 4.6 (foundation) and Section 4.7 (marketing).
--   All members read; company_admin + system_admin write.
-- =============================================================

-- ---- company_foundation (singleton per company) ---------------
create table if not exists public.company_foundation (
  company_id uuid primary key references public.companies(id) on delete cascade,
  purpose_statement text,
  purpose_context text,
  vision_title text,
  vision_tagline text,
  vision_body text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists company_foundation_set_updated_at
  on public.company_foundation;
create trigger company_foundation_set_updated_at
before update on public.company_foundation
for each row execute function public.set_updated_at();

-- ---- foundation_items (values / milestones / differentiators) --
create table if not exists public.foundation_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null check (kind in ('core_value','vision_milestone','differentiator')),
  title text not null,
  body text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists foundation_items_company_kind_idx
  on public.foundation_items (company_id, kind, sort_order);

drop trigger if exists foundation_items_set_updated_at on public.foundation_items;
create trigger foundation_items_set_updated_at
before update on public.foundation_items
for each row execute function public.set_updated_at();

-- ---- marketing_strategy (singleton per company) ---------------
create table if not exists public.marketing_strategy (
  company_id uuid primary key references public.companies(id) on delete cascade,
  positioning_statement text,
  executive_summary text,
  anchoring_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists marketing_strategy_set_updated_at on public.marketing_strategy;
create trigger marketing_strategy_set_updated_at
before update on public.marketing_strategy
for each row execute function public.set_updated_at();

-- ---- messaging_pillars ----------------------------------------
create table if not exists public.messaging_pillars (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  message text,
  language_bank jsonb not null default '[]'::jsonb,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists messaging_pillars_company_idx
  on public.messaging_pillars (company_id, sort_order);

drop trigger if exists messaging_pillars_set_updated_at on public.messaging_pillars;
create trigger messaging_pillars_set_updated_at
before update on public.messaging_pillars
for each row execute function public.set_updated_at();

-- ---- marketing_snippets (hooks, avoid, ICP, elevated phrases) --
create table if not exists public.marketing_snippets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null check (kind in (
    'short_hook','long_hook','website_copy','avoid',
    'icp_best_fit','icp_psychographic','elevated_phrase'
  )),
  content text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists marketing_snippets_company_kind_idx
  on public.marketing_snippets (company_id, kind, sort_order);

drop trigger if exists marketing_snippets_set_updated_at on public.marketing_snippets;
create trigger marketing_snippets_set_updated_at
before update on public.marketing_snippets
for each row execute function public.set_updated_at();

-- =============================================================
-- RLS (Section 5)
-- =============================================================
alter table public.company_foundation enable row level security;
alter table public.foundation_items   enable row level security;
alter table public.marketing_strategy enable row level security;
alter table public.messaging_pillars  enable row level security;
alter table public.marketing_snippets enable row level security;

alter table public.company_foundation force row level security;
alter table public.foundation_items   force row level security;
alter table public.marketing_strategy force row level security;
alter table public.messaging_pillars  force row level security;
alter table public.marketing_snippets force row level security;

-- Helper macro (as SQL, since Postgres has no policy macros): all five
-- tables follow the same pattern — company members read own company;
-- company_admin/system_admin write. The company_id column exists on all
-- five (company_foundation and marketing_strategy use it as their PK).

-- ---- company_foundation ----
drop policy if exists company_foundation_select on public.company_foundation;
create policy company_foundation_select on public.company_foundation
for select to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.company_id is not null and ap.company_id = public.company_foundation.company_id)
  )
);

drop policy if exists company_foundation_insert on public.company_foundation;
create policy company_foundation_insert on public.company_foundation
for insert to authenticated
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.company_foundation.company_id)
  )
);

drop policy if exists company_foundation_update on public.company_foundation;
create policy company_foundation_update on public.company_foundation
for update to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.company_foundation.company_id)
  )
)
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.company_foundation.company_id)
  )
);

drop policy if exists company_foundation_delete on public.company_foundation;
create policy company_foundation_delete on public.company_foundation
for delete to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.company_foundation.company_id)
  )
);

-- ---- foundation_items ----
drop policy if exists foundation_items_select on public.foundation_items;
create policy foundation_items_select on public.foundation_items
for select to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.company_id is not null and ap.company_id = public.foundation_items.company_id)
  )
);

drop policy if exists foundation_items_insert on public.foundation_items;
create policy foundation_items_insert on public.foundation_items
for insert to authenticated
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.foundation_items.company_id)
  )
);

drop policy if exists foundation_items_update on public.foundation_items;
create policy foundation_items_update on public.foundation_items
for update to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.foundation_items.company_id)
  )
)
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.foundation_items.company_id)
  )
);

drop policy if exists foundation_items_delete on public.foundation_items;
create policy foundation_items_delete on public.foundation_items
for delete to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.foundation_items.company_id)
  )
);

-- ---- marketing_strategy ----
drop policy if exists marketing_strategy_select on public.marketing_strategy;
create policy marketing_strategy_select on public.marketing_strategy
for select to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.company_id is not null and ap.company_id = public.marketing_strategy.company_id)
  )
);

drop policy if exists marketing_strategy_insert on public.marketing_strategy;
create policy marketing_strategy_insert on public.marketing_strategy
for insert to authenticated
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.marketing_strategy.company_id)
  )
);

drop policy if exists marketing_strategy_update on public.marketing_strategy;
create policy marketing_strategy_update on public.marketing_strategy
for update to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.marketing_strategy.company_id)
  )
)
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.marketing_strategy.company_id)
  )
);

drop policy if exists marketing_strategy_delete on public.marketing_strategy;
create policy marketing_strategy_delete on public.marketing_strategy
for delete to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.marketing_strategy.company_id)
  )
);

-- ---- messaging_pillars ----
drop policy if exists messaging_pillars_select on public.messaging_pillars;
create policy messaging_pillars_select on public.messaging_pillars
for select to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.company_id is not null and ap.company_id = public.messaging_pillars.company_id)
  )
);

drop policy if exists messaging_pillars_insert on public.messaging_pillars;
create policy messaging_pillars_insert on public.messaging_pillars
for insert to authenticated
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.messaging_pillars.company_id)
  )
);

drop policy if exists messaging_pillars_update on public.messaging_pillars;
create policy messaging_pillars_update on public.messaging_pillars
for update to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.messaging_pillars.company_id)
  )
)
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.messaging_pillars.company_id)
  )
);

drop policy if exists messaging_pillars_delete on public.messaging_pillars;
create policy messaging_pillars_delete on public.messaging_pillars
for delete to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.messaging_pillars.company_id)
  )
);

-- ---- marketing_snippets ----
drop policy if exists marketing_snippets_select on public.marketing_snippets;
create policy marketing_snippets_select on public.marketing_snippets
for select to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.company_id is not null and ap.company_id = public.marketing_snippets.company_id)
  )
);

drop policy if exists marketing_snippets_insert on public.marketing_snippets;
create policy marketing_snippets_insert on public.marketing_snippets
for insert to authenticated
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.marketing_snippets.company_id)
  )
);

drop policy if exists marketing_snippets_update on public.marketing_snippets;
create policy marketing_snippets_update on public.marketing_snippets
for update to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.marketing_snippets.company_id)
  )
)
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.marketing_snippets.company_id)
  )
);

drop policy if exists marketing_snippets_delete on public.marketing_snippets;
create policy marketing_snippets_delete on public.marketing_snippets
for delete to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.marketing_snippets.company_id)
  )
);
