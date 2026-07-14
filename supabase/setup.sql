-- =================================================================
-- AiMS Execution Platform — full database setup
--
-- Combines migrations 0001 → 0007 into a single re-runnable script.
-- Safe to run on a fresh Supabase project OR on one where an earlier
-- migration was applied partially. Won't destroy data.
--
-- Paste the whole file into Supabase → SQL Editor → New query → Run.
-- =================================================================


-- =================================================================
-- 0001  helpers
-- =================================================================

create extension if not exists "pgcrypto";

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;


-- =================================================================
-- 0002  identity (companies, profiles, invitations)
-- =================================================================

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'America/Anchorage',
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists companies_set_updated_at on public.companies;
create trigger companies_set_updated_at
before update on public.companies
for each row execute function public.set_updated_at();

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  full_name text not null,
  position text,
  role text not null default 'team_member'
    check (role in ('system_admin','company_admin','team_member')),
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_role_requires_company
    check (role = 'system_admin' or company_id is not null)
);

create index if not exists profiles_company_id_idx on public.profiles (company_id);
create index if not exists profiles_role_idx on public.profiles (role);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  email text not null,
  full_name text not null,
  position text,
  role text not null default 'team_member'
    check (role in ('company_admin','team_member')),
  invited_by uuid not null references public.profiles(id) on delete restrict,
  token uuid not null default gen_random_uuid(),
  status text not null default 'pending' check (status in ('pending','accepted','revoked')),
  expires_at timestamptz not null default now() + interval '14 days',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists invitations_pending_unique
  on public.invitations (company_id, lower(email))
  where status = 'pending';
create index if not exists invitations_company_id_idx on public.invitations (company_id);
create index if not exists invitations_token_idx on public.invitations (token);
create index if not exists invitations_email_idx on public.invitations (lower(email));

drop trigger if exists invitations_set_updated_at on public.invitations;
create trigger invitations_set_updated_at
before update on public.invitations
for each row execute function public.set_updated_at();


-- =================================================================
-- 0003  quarters
-- =================================================================

create table if not exists public.quarters (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  label text not null,
  start_date date not null,
  end_date date not null,
  status text not null default 'open' check (status in ('open','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quarters_end_after_start check (end_date >= start_date)
);

create unique index if not exists quarters_label_unique on public.quarters (company_id, label);
create unique index if not exists quarters_one_open on public.quarters (company_id) where status = 'open';
create index if not exists quarters_company_id_idx on public.quarters (company_id);

drop trigger if exists quarters_set_updated_at on public.quarters;
create trigger quarters_set_updated_at
before update on public.quarters
for each row execute function public.set_updated_at();


-- =================================================================
-- 0004  RLS helper + policies for identity + quarters
-- =================================================================

create or replace function public.auth_profile()
returns table (uid uuid, company_id uuid, role text)
language sql
security definer
stable
set search_path = public
as $$
  select p.id, p.company_id, p.role
  from public.profiles p
  where p.id = auth.uid()
$$;

revoke all on function public.auth_profile() from public;
grant execute on function public.auth_profile() to authenticated, anon;

alter table public.companies   enable row level security;
alter table public.profiles    enable row level security;
alter table public.invitations enable row level security;
alter table public.quarters    enable row level security;

alter table public.companies   force row level security;
alter table public.profiles    force row level security;
alter table public.invitations force row level security;
alter table public.quarters    force row level security;

-- ---- companies ----
drop policy if exists companies_select on public.companies;
create policy companies_select on public.companies
for select to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or ap.company_id = public.companies.id
  )
);

drop policy if exists companies_insert on public.companies;
create policy companies_insert on public.companies
for insert to authenticated
with check (exists (select 1 from public.auth_profile() ap where ap.role = 'system_admin'));

drop policy if exists companies_update on public.companies;
create policy companies_update on public.companies
for update to authenticated
using (exists (select 1 from public.auth_profile() ap where ap.role = 'system_admin'))
with check (exists (select 1 from public.auth_profile() ap where ap.role = 'system_admin'));

drop policy if exists companies_delete on public.companies;
create policy companies_delete on public.companies
for delete to authenticated
using (exists (select 1 from public.auth_profile() ap where ap.role = 'system_admin'));

-- ---- profiles ----
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
for select to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.company_id is not null and ap.company_id = public.profiles.company_id)
       or ap.uid = public.profiles.id
  )
);

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
for insert to authenticated
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (
         ap.role = 'company_admin'
         and ap.company_id is not null
         and ap.company_id = public.profiles.company_id
         and public.profiles.role in ('company_admin','team_member')
       )
  )
);

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
for update to authenticated
using (public.profiles.id = auth.uid())
with check (
  public.profiles.id = auth.uid()
  and public.profiles.role = (select ap.role from public.auth_profile() ap)
  and public.profiles.company_id is not distinct from (select ap.company_id from public.auth_profile() ap)
);

drop policy if exists profiles_update_company_admin on public.profiles;
create policy profiles_update_company_admin on public.profiles
for update to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'company_admin'
      and ap.company_id is not null
      and ap.company_id = public.profiles.company_id
      and ap.uid <> public.profiles.id
  )
)
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'company_admin'
      and ap.company_id is not null
      and ap.company_id = public.profiles.company_id
      and ap.uid <> public.profiles.id
      and public.profiles.role in ('company_admin','team_member')
  )
);

drop policy if exists profiles_update_system_admin on public.profiles;
create policy profiles_update_system_admin on public.profiles
for update to authenticated
using (exists (select 1 from public.auth_profile() ap where ap.role = 'system_admin'))
with check (exists (select 1 from public.auth_profile() ap where ap.role = 'system_admin'));

drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles
for delete to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (
         ap.role = 'company_admin'
         and ap.company_id is not null
         and ap.company_id = public.profiles.company_id
         and ap.uid <> public.profiles.id
       )
  )
);

-- ---- invitations ----
drop policy if exists invitations_select on public.invitations;
create policy invitations_select on public.invitations
for select to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (
         ap.role = 'company_admin'
         and ap.company_id is not null
         and ap.company_id = public.invitations.company_id
       )
  )
);

drop policy if exists invitations_insert on public.invitations;
create policy invitations_insert on public.invitations
for insert to authenticated
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (
         ap.role = 'company_admin'
         and ap.company_id is not null
         and ap.company_id = public.invitations.company_id
       )
  )
);

drop policy if exists invitations_update on public.invitations;
create policy invitations_update on public.invitations
for update to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (
         ap.role = 'company_admin'
         and ap.company_id is not null
         and ap.company_id = public.invitations.company_id
       )
  )
)
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (
         ap.role = 'company_admin'
         and ap.company_id is not null
         and ap.company_id = public.invitations.company_id
       )
  )
);

drop policy if exists invitations_delete on public.invitations;
create policy invitations_delete on public.invitations
for delete to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (
         ap.role = 'company_admin'
         and ap.company_id is not null
         and ap.company_id = public.invitations.company_id
       )
  )
);

-- ---- quarters ----
drop policy if exists quarters_select on public.quarters;
create policy quarters_select on public.quarters
for select to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.company_id is not null and ap.company_id = public.quarters.company_id)
  )
);

drop policy if exists quarters_insert on public.quarters;
create policy quarters_insert on public.quarters
for insert to authenticated
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (
         ap.role = 'company_admin'
         and ap.company_id is not null
         and ap.company_id = public.quarters.company_id
       )
  )
);

drop policy if exists quarters_update on public.quarters;
create policy quarters_update on public.quarters
for update to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (
         ap.role = 'company_admin'
         and ap.company_id is not null
         and ap.company_id = public.quarters.company_id
       )
  )
)
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (
         ap.role = 'company_admin'
         and ap.company_id is not null
         and ap.company_id = public.quarters.company_id
       )
  )
);

drop policy if exists quarters_delete on public.quarters;
create policy quarters_delete on public.quarters
for delete to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (
         ap.role = 'company_admin'
         and ap.company_id is not null
         and ap.company_id = public.quarters.company_id
       )
  )
);


-- =================================================================
-- 0005  goal cascade (SFAs, annual_goals, priorities) + RLS
-- =================================================================

create table if not exists public.strategic_focus_areas (
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

create index if not exists sfa_company_id_idx on public.strategic_focus_areas (company_id);
create index if not exists sfa_sponsor_id_idx on public.strategic_focus_areas (sponsor_id);
create index if not exists sfa_sort_idx on public.strategic_focus_areas (company_id, sort_order);

drop trigger if exists sfa_set_updated_at on public.strategic_focus_areas;
create trigger sfa_set_updated_at
before update on public.strategic_focus_areas
for each row execute function public.set_updated_at();

create table if not exists public.annual_goals (
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

create index if not exists annual_goals_company_id_idx on public.annual_goals (company_id);
create index if not exists annual_goals_sfa_id_idx on public.annual_goals (sfa_id);
create index if not exists annual_goals_owner_id_idx on public.annual_goals (owner_id);
create index if not exists annual_goals_sort_idx on public.annual_goals (company_id, sort_order);

drop trigger if exists annual_goals_set_updated_at on public.annual_goals;
create trigger annual_goals_set_updated_at
before update on public.annual_goals
for each row execute function public.set_updated_at();

create table if not exists public.priorities (
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

create index if not exists priorities_company_id_idx on public.priorities (company_id);
create index if not exists priorities_quarter_id_idx on public.priorities (quarter_id);
create index if not exists priorities_annual_goal_id_idx on public.priorities (annual_goal_id);
create index if not exists priorities_owner_id_idx on public.priorities (owner_id);
create index if not exists priorities_sort_idx on public.priorities (company_id, quarter_id, sort_order);

drop trigger if exists priorities_set_updated_at on public.priorities;
create trigger priorities_set_updated_at
before update on public.priorities
for each row execute function public.set_updated_at();

alter table public.strategic_focus_areas enable row level security;
alter table public.annual_goals          enable row level security;
alter table public.priorities            enable row level security;

alter table public.strategic_focus_areas force row level security;
alter table public.annual_goals          force row level security;
alter table public.priorities            force row level security;

-- ---- strategic_focus_areas policies ----
drop policy if exists sfa_select on public.strategic_focus_areas;
create policy sfa_select on public.strategic_focus_areas
for select to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.company_id is not null and ap.company_id = public.strategic_focus_areas.company_id)
  )
);

drop policy if exists sfa_insert on public.strategic_focus_areas;
create policy sfa_insert on public.strategic_focus_areas
for insert to authenticated
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.strategic_focus_areas.company_id)
  )
);

drop policy if exists sfa_update_admin on public.strategic_focus_areas;
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

drop policy if exists sfa_update_owner on public.strategic_focus_areas;
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

drop policy if exists sfa_delete on public.strategic_focus_areas;
create policy sfa_delete on public.strategic_focus_areas
for delete to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.strategic_focus_areas.company_id)
  )
);

-- ---- annual_goals policies ----
drop policy if exists annual_goals_select on public.annual_goals;
create policy annual_goals_select on public.annual_goals
for select to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.company_id is not null and ap.company_id = public.annual_goals.company_id)
  )
);

drop policy if exists annual_goals_insert on public.annual_goals;
create policy annual_goals_insert on public.annual_goals
for insert to authenticated
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.annual_goals.company_id)
  )
);

drop policy if exists annual_goals_update_admin on public.annual_goals;
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

drop policy if exists annual_goals_update_owner on public.annual_goals;
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

drop policy if exists annual_goals_delete on public.annual_goals;
create policy annual_goals_delete on public.annual_goals
for delete to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.annual_goals.company_id)
  )
);

-- ---- priorities policies ----
drop policy if exists priorities_select on public.priorities;
create policy priorities_select on public.priorities
for select to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.company_id is not null and ap.company_id = public.priorities.company_id)
  )
);

drop policy if exists priorities_insert on public.priorities;
create policy priorities_insert on public.priorities
for insert to authenticated
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.priorities.company_id)
  )
);

drop policy if exists priorities_update_admin on public.priorities;
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

drop policy if exists priorities_update_owner on public.priorities;
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

drop policy if exists priorities_delete on public.priorities;
create policy priorities_delete on public.priorities
for delete to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.priorities.company_id)
  )
);


-- =================================================================
-- 0006  commitments (the heartbeat) + RLS
-- =================================================================

create table if not exists public.commitments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  priority_id uuid not null references public.priorities(id) on delete restrict,
  owner_id uuid not null references public.profiles(id) on delete restrict,
  description text not null,
  week_ending date not null,
  due_date date not null,
  status text not null default 'open'
    check (status in ('open','kept','missed','carried')),
  completed_at timestamptz,
  missed_reason text,
  carried_from_id uuid references public.commitments(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint missed_needs_reason
    check (status <> 'missed' or missed_reason is not null)
);

create index if not exists commitments_company_week_idx
  on public.commitments (company_id, week_ending);
create index if not exists commitments_owner_week_idx
  on public.commitments (owner_id, week_ending);
create index if not exists commitments_priority_idx
  on public.commitments (priority_id);
create index if not exists commitments_status_idx
  on public.commitments (company_id, status);
create index if not exists commitments_carried_from_idx
  on public.commitments (carried_from_id) where carried_from_id is not null;

drop trigger if exists commitments_set_updated_at on public.commitments;
create trigger commitments_set_updated_at
before update on public.commitments
for each row execute function public.set_updated_at();

alter table public.commitments enable row level security;
alter table public.commitments force row level security;

drop policy if exists commitments_select on public.commitments;
create policy commitments_select on public.commitments
for select to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.company_id is not null and ap.company_id = public.commitments.company_id)
  )
);

drop policy if exists commitments_insert_owner on public.commitments;
create policy commitments_insert_owner on public.commitments
for insert to authenticated
with check (
  public.commitments.owner_id = auth.uid()
  and exists (
    select 1 from public.auth_profile() ap
    where ap.company_id = public.commitments.company_id
  )
);

drop policy if exists commitments_insert_admin on public.commitments;
create policy commitments_insert_admin on public.commitments
for insert to authenticated
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.commitments.company_id)
  )
);

drop policy if exists commitments_update_owner on public.commitments;
create policy commitments_update_owner on public.commitments
for update to authenticated
using (
  public.commitments.owner_id = auth.uid()
  and exists (
    select 1 from public.auth_profile() ap
    where ap.company_id = public.commitments.company_id
  )
)
with check (
  public.commitments.owner_id = auth.uid()
);

drop policy if exists commitments_update_admin on public.commitments;
create policy commitments_update_admin on public.commitments
for update to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.commitments.company_id)
  )
)
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.commitments.company_id)
  )
);

drop policy if exists commitments_delete_owner on public.commitments;
create policy commitments_delete_owner on public.commitments
for delete to authenticated
using (
  public.commitments.owner_id = auth.uid()
  and public.commitments.status = 'open'
);

drop policy if exists commitments_delete_admin on public.commitments;
create policy commitments_delete_admin on public.commitments
for delete to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.commitments.company_id)
  )
);


-- =================================================================
-- 0007  progress views
-- =================================================================

create or replace view public.priority_progress as
select
  p.id            as priority_id,
  p.company_id,
  p.status,
  p.archived,
  coalesce(sum(case when c.status = 'kept'   then 1 else 0 end), 0) as kept_count,
  coalesce(sum(case when c.status = 'open'   then 1 else 0 end), 0) as open_count,
  coalesce(sum(case when c.status = 'missed' then 1 else 0 end), 0) as missed_count,
  coalesce(sum(case when c.status = 'carried' then 1 else 0 end), 0) as carried_count,
  count(c.id) filter (where c.status <> 'carried') as denominator,
  case
    when p.status = 'complete' then 100
    when count(c.id) filter (where c.status <> 'carried') = 0 then null
    else round(
      100.0
      * sum(case when c.status = 'kept' then 1 else 0 end)::numeric
      / nullif(count(c.id) filter (where c.status <> 'carried'), 0)::numeric
    )::int
  end             as percent
from public.priorities p
left join public.commitments c on c.priority_id = p.id
group by p.id;

create or replace view public.annual_goal_progress as
select
  g.id           as annual_goal_id,
  g.company_id,
  g.status,
  g.archived,
  case
    when g.status = 'complete' then 100
    when count(pp.priority_id) filter (
      where pp.archived = false and pp.percent is not null
    ) = 0 then null
    else round(avg(
      case when pp.archived = false and pp.percent is not null then pp.percent end
    ))::int
  end            as percent
from public.annual_goals g
left join public.priorities p on p.annual_goal_id = g.id and p.archived = false
left join public.priority_progress pp on pp.priority_id = p.id
group by g.id;

create or replace view public.sfa_progress as
select
  s.id           as sfa_id,
  s.company_id,
  s.status,
  s.archived,
  case
    when s.status = 'complete' then 100
    when count(gp.annual_goal_id) filter (
      where gp.archived = false and gp.percent is not null
    ) = 0 then null
    else round(avg(
      case when gp.archived = false and gp.percent is not null then gp.percent end
    ))::int
  end            as percent
from public.strategic_focus_areas s
left join public.annual_goals g on g.sfa_id = s.id and g.archived = false
left join public.annual_goal_progress gp on gp.annual_goal_id = g.id
group by s.id;

alter view public.priority_progress    set (security_invoker = on);
alter view public.annual_goal_progress set (security_invoker = on);
alter view public.sfa_progress         set (security_invoker = on);

grant select on public.priority_progress    to authenticated;
grant select on public.annual_goal_progress to authenticated;
grant select on public.sfa_progress         to authenticated;


-- =================================================================
-- 0008  functional scorecard (Phase 6)
-- =================================================================

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


-- =================================================================
-- 0009  company foundation + marketing strategy (Phase 7)
-- =================================================================

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

-- All five tables: members read; company_admin + system_admin write.

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


-- =================================================================
-- Done. You should now have:
--   16 tables: companies, profiles, invitations, quarters,
--              strategic_focus_areas, annual_goals, priorities,
--              commitments, functional_areas, scorecard_metrics,
--              scorecard_entries, company_foundation, foundation_items,
--              marketing_strategy, messaging_pillars, marketing_snippets
--              (+ auth.users from Supabase)
--   3 views:   priority_progress, annual_goal_progress, sfa_progress
--   1 helper:  auth_profile()  (SECURITY DEFINER)
--   RLS + policies on every table.
-- =================================================================
