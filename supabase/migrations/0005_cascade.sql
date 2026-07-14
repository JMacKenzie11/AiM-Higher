-- =============================================================
-- Phase 3 — Migration 0005: the goal cascade (Section 4.3).
--   strategic_focus_areas → annual_goals → priorities.
--   Annual Goals may exist without a parent SFA.
--   Priorities may exist without a parent Annual Goal.
--   Priorities MUST have a quarter_id.
-- RLS policies included at the end per Section 5.
-- =============================================================

-- ---- statuses shared by all three -----------------------------
-- 'not_started' | 'on_track' | 'behind' | 'complete' | 'ongoing'

-- ---- strategic_focus_areas -----------------------------------
create table public.strategic_focus_areas (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  title text not null,
  description text,
  sponsor_id uuid references public.profiles(id) on delete set null,
  status text not null default 'not_started'
    check (status in ('not_started','on_track','behind','complete','ongoing')),
  sort_order int not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index sfa_company_id_idx on public.strategic_focus_areas (company_id);
create index sfa_sponsor_id_idx on public.strategic_focus_areas (sponsor_id);
create index sfa_sort_idx on public.strategic_focus_areas (company_id, sort_order);

create trigger sfa_set_updated_at
before update on public.strategic_focus_areas
for each row execute function public.set_updated_at();

-- ---- annual_goals ---------------------------------------------
create table public.annual_goals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  sfa_id uuid references public.strategic_focus_areas(id) on delete set null,
  title text not null,
  description text,
  owner_id uuid references public.profiles(id) on delete set null,
  target_date date,
  status text not null default 'not_started'
    check (status in ('not_started','on_track','behind','complete','ongoing')),
  sort_order int not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index annual_goals_company_id_idx on public.annual_goals (company_id);
create index annual_goals_sfa_id_idx on public.annual_goals (sfa_id);
create index annual_goals_owner_id_idx on public.annual_goals (owner_id);
create index annual_goals_sort_idx on public.annual_goals (company_id, sort_order);

create trigger annual_goals_set_updated_at
before update on public.annual_goals
for each row execute function public.set_updated_at();

-- ---- priorities ----------------------------------------------
create table public.priorities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  annual_goal_id uuid references public.annual_goals(id) on delete set null,
  quarter_id uuid not null references public.quarters(id) on delete restrict,
  title text not null,
  description text,
  owner_id uuid references public.profiles(id) on delete set null,
  due_date date,
  status text not null default 'not_started'
    check (status in ('not_started','on_track','behind','complete','ongoing')),
  sort_order int not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index priorities_company_id_idx on public.priorities (company_id);
create index priorities_quarter_id_idx on public.priorities (quarter_id);
create index priorities_annual_goal_id_idx on public.priorities (annual_goal_id);
create index priorities_owner_id_idx on public.priorities (owner_id);
create index priorities_sort_idx on public.priorities (company_id, quarter_id, sort_order);

create trigger priorities_set_updated_at
before update on public.priorities
for each row execute function public.set_updated_at();

-- =============================================================
-- RLS
-- =============================================================
alter table public.strategic_focus_areas enable row level security;
alter table public.annual_goals          enable row level security;
alter table public.priorities            enable row level security;

alter table public.strategic_focus_areas force row level security;
alter table public.annual_goals          force row level security;
alter table public.priorities            force row level security;

-- Helper predicates come as inline EXISTS(auth_profile()) since the
-- helper is SECURITY DEFINER and skips recursion. Column-level
-- "owner may only update status" enforcement lives in the server action;
-- RLS grants the owner update rights broadly. This mirrors the
-- pattern used for profiles.self_update in 0004_rls.sql.

-- ---- strategic_focus_areas policies --------------------------
create policy sfa_select on public.strategic_focus_areas
for select to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.company_id is not null and ap.company_id = public.strategic_focus_areas.company_id)
  )
);

create policy sfa_insert on public.strategic_focus_areas
for insert to authenticated
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.strategic_focus_areas.company_id)
  )
);

create policy sfa_update_admin on public.strategic_focus_areas
for update to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.strategic_focus_areas.company_id)
  )
)
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.strategic_focus_areas.company_id)
  )
);

create policy sfa_update_owner on public.strategic_focus_areas
for update to authenticated
using (
  public.strategic_focus_areas.sponsor_id = auth.uid()
  and exists (
    select 1 from public.auth_profile() ap
    where ap.company_id = public.strategic_focus_areas.company_id
  )
)
with check (
  public.strategic_focus_areas.sponsor_id = auth.uid()
);

create policy sfa_delete on public.strategic_focus_areas
for delete to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.strategic_focus_areas.company_id)
  )
);

-- ---- annual_goals policies -----------------------------------
create policy annual_goals_select on public.annual_goals
for select to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.company_id is not null and ap.company_id = public.annual_goals.company_id)
  )
);

create policy annual_goals_insert on public.annual_goals
for insert to authenticated
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.annual_goals.company_id)
  )
);

create policy annual_goals_update_admin on public.annual_goals
for update to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.annual_goals.company_id)
  )
)
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.annual_goals.company_id)
  )
);

create policy annual_goals_update_owner on public.annual_goals
for update to authenticated
using (
  public.annual_goals.owner_id = auth.uid()
  and exists (
    select 1 from public.auth_profile() ap
    where ap.company_id = public.annual_goals.company_id
  )
)
with check (
  public.annual_goals.owner_id = auth.uid()
);

create policy annual_goals_delete on public.annual_goals
for delete to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.annual_goals.company_id)
  )
);

-- ---- priorities policies -------------------------------------
create policy priorities_select on public.priorities
for select to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.company_id is not null and ap.company_id = public.priorities.company_id)
  )
);

create policy priorities_insert on public.priorities
for insert to authenticated
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.priorities.company_id)
  )
);

create policy priorities_update_admin on public.priorities
for update to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.priorities.company_id)
  )
)
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.priorities.company_id)
  )
);

create policy priorities_update_owner on public.priorities
for update to authenticated
using (
  public.priorities.owner_id = auth.uid()
  and exists (
    select 1 from public.auth_profile() ap
    where ap.company_id = public.priorities.company_id
  )
)
with check (
  public.priorities.owner_id = auth.uid()
);

create policy priorities_delete on public.priorities
for delete to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.priorities.company_id)
  )
);
