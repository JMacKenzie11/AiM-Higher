-- =============================================================
-- Migration 0124 — function_decision_rights
--
-- Independent decisions the seat holder can make without escalation
-- (budget, hiring, vendor selection, prioritization, etc). Feeds the
-- "Decision Rights" section of the Role Description generator and
-- shows up as its own section on /chart/function/[id] when the
-- company has the role_descriptions feature enabled.
--
-- No default row / no trigger — a function has zero decision rights
-- until someone adds them.
-- =============================================================

create table if not exists public.function_decision_rights (
  id uuid primary key default gen_random_uuid(),
  function_id uuid not null references public.functions(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  body text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists function_decision_rights_function_idx
  on public.function_decision_rights (function_id, sort_order);

drop trigger if exists function_decision_rights_set_updated_at
  on public.function_decision_rights;
create trigger function_decision_rights_set_updated_at
before update on public.function_decision_rights
for each row execute function public.set_updated_at();

-- =============================================================
-- RLS — mirror function_roles (system_admin or company_admin of
-- the function's company). Any company member can read.
-- =============================================================
alter table public.function_decision_rights enable row level security;
alter table public.function_decision_rights force row level security;

drop policy if exists function_decision_rights_select on public.function_decision_rights;
create policy function_decision_rights_select on public.function_decision_rights
for select to authenticated
using (
  exists (
    select 1
    from public.auth_profile() ap
    join public.functions f on f.id = public.function_decision_rights.function_id
    where ap.role = 'system_admin'
       or (ap.company_id is not null and ap.company_id = f.company_id)
  )
);

drop policy if exists function_decision_rights_insert on public.function_decision_rights;
create policy function_decision_rights_insert on public.function_decision_rights
for insert to authenticated
with check (
  exists (
    select 1
    from public.auth_profile() ap
    join public.functions f on f.id = public.function_decision_rights.function_id
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = f.company_id)
  )
);

drop policy if exists function_decision_rights_update on public.function_decision_rights;
create policy function_decision_rights_update on public.function_decision_rights
for update to authenticated
using (
  exists (
    select 1
    from public.auth_profile() ap
    join public.functions f on f.id = public.function_decision_rights.function_id
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = f.company_id)
  )
)
with check (
  exists (
    select 1
    from public.auth_profile() ap
    join public.functions f on f.id = public.function_decision_rights.function_id
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = f.company_id)
  )
);

drop policy if exists function_decision_rights_delete on public.function_decision_rights;
create policy function_decision_rights_delete on public.function_decision_rights
for delete to authenticated
using (
  exists (
    select 1
    from public.auth_profile() ap
    join public.functions f on f.id = public.function_decision_rights.function_id
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = f.company_id)
  )
);
