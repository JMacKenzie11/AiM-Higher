-- =============================================================
-- Migration 0107: Roles & Responsibilities on functions
--
-- Every function gets a list of R&R items. One row per function is
-- flagged is_default=true and holds "Lead, Track, Decide" — the
-- baseline responsibility of every seat. That default row is created
-- by trigger on function insert and can never be edited or deleted
-- (RLS blocks update/delete when is_default=true).
--
-- The chart tree renders this list on each function box in place of
-- the old outcomes list. Outcomes stay in the DB (relabeled
-- "Success Measures" in the UI) and continue to live on the function
-- detail page with their success_measures children and weekly entries.
-- =============================================================

create table if not exists public.function_roles (
  id uuid primary key default gen_random_uuid(),
  function_id uuid not null references public.functions(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  body text,
  sort_order int not null default 0,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists function_roles_function_idx
  on public.function_roles (function_id, sort_order);

-- One default row per function — enforced at the DB layer so nothing
-- upstream can accidentally create a second baseline.
create unique index if not exists function_roles_default_per_function
  on public.function_roles (function_id)
  where is_default = true;

drop trigger if exists function_roles_set_updated_at on public.function_roles;
create trigger function_roles_set_updated_at
before update on public.function_roles
for each row execute function public.set_updated_at();

-- =============================================================
-- Auto-create the default "Lead, Track, Decide" role for every
-- new function. Backfill runs below for functions that predate
-- this migration.
-- =============================================================
create or replace function public.functions_add_default_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.function_roles (function_id, title, sort_order, is_default)
  values (new.id, 'Lead, Track, Decide', 0, true);
  return new;
end;
$$;

drop trigger if exists functions_add_default_role_trg on public.functions;
create trigger functions_add_default_role_trg
after insert on public.functions
for each row execute function public.functions_add_default_role();

-- Backfill: every function without a default gets one now.
insert into public.function_roles (function_id, title, sort_order, is_default)
select f.id, 'Lead, Track, Decide', 0, true
from public.functions f
where not exists (
  select 1 from public.function_roles fr
  where fr.function_id = f.id and fr.is_default = true
);

-- =============================================================
-- RLS
-- =============================================================
alter table public.function_roles enable row level security;
alter table public.function_roles force row level security;

-- select: system_admin OR same-company member (via join to functions)
drop policy if exists function_roles_select on public.function_roles;
create policy function_roles_select on public.function_roles
for select to authenticated
using (
  exists (
    select 1
    from public.auth_profile() ap
    join public.functions f on f.id = public.function_roles.function_id
    where ap.role = 'system_admin'
       or (ap.company_id is not null and ap.company_id = f.company_id)
  )
);

-- insert: system_admin OR company_admin of the function's company.
-- The trigger uses SECURITY DEFINER so it can insert the default row
-- regardless of the calling user's role.
drop policy if exists function_roles_insert on public.function_roles;
create policy function_roles_insert on public.function_roles
for insert to authenticated
with check (
  exists (
    select 1
    from public.auth_profile() ap
    join public.functions f on f.id = public.function_roles.function_id
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = f.company_id)
  )
);

-- update: same admin rule AND the row is not the default.
drop policy if exists function_roles_update on public.function_roles;
create policy function_roles_update on public.function_roles
for update to authenticated
using (
  is_default = false
  and exists (
    select 1
    from public.auth_profile() ap
    join public.functions f on f.id = public.function_roles.function_id
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = f.company_id)
  )
)
with check (
  is_default = false
  and exists (
    select 1
    from public.auth_profile() ap
    join public.functions f on f.id = public.function_roles.function_id
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = f.company_id)
  )
);

-- delete: same admin rule AND the row is not the default.
drop policy if exists function_roles_delete on public.function_roles;
create policy function_roles_delete on public.function_roles
for delete to authenticated
using (
  is_default = false
  and exists (
    select 1
    from public.auth_profile() ap
    join public.functions f on f.id = public.function_roles.function_id
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = f.company_id)
  )
);
