-- =============================================================
-- Migration 0125 — function_competencies
--
-- Observable behaviors / measurable standards that indicate what
-- excellence looks like in the seat. Feeds the "Competency
-- Indicators (Development Framework)" section of the Role
-- Description generator and shows up as its own section on
-- /chart/function/[id] when the company has the role_descriptions
-- feature enabled.
--
-- No default row — a function has zero competency indicators until
-- someone adds them. The RD interview recommends 3–5 when generating
-- a description; nothing in the schema enforces a range because a
-- freshly-created function will legitimately have zero for a while.
-- =============================================================

create table if not exists public.function_competencies (
  id uuid primary key default gen_random_uuid(),
  function_id uuid not null references public.functions(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  body text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists function_competencies_function_idx
  on public.function_competencies (function_id, sort_order);

drop trigger if exists function_competencies_set_updated_at
  on public.function_competencies;
create trigger function_competencies_set_updated_at
before update on public.function_competencies
for each row execute function public.set_updated_at();

-- =============================================================
-- RLS — mirror function_decision_rights.
-- =============================================================
alter table public.function_competencies enable row level security;
alter table public.function_competencies force row level security;

drop policy if exists function_competencies_select on public.function_competencies;
create policy function_competencies_select on public.function_competencies
for select to authenticated
using (
  exists (
    select 1
    from public.auth_profile() ap
    join public.functions f on f.id = public.function_competencies.function_id
    where ap.role = 'system_admin'
       or (ap.company_id is not null and ap.company_id = f.company_id)
  )
);

drop policy if exists function_competencies_insert on public.function_competencies;
create policy function_competencies_insert on public.function_competencies
for insert to authenticated
with check (
  exists (
    select 1
    from public.auth_profile() ap
    join public.functions f on f.id = public.function_competencies.function_id
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = f.company_id)
  )
);

drop policy if exists function_competencies_update on public.function_competencies;
create policy function_competencies_update on public.function_competencies
for update to authenticated
using (
  exists (
    select 1
    from public.auth_profile() ap
    join public.functions f on f.id = public.function_competencies.function_id
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = f.company_id)
  )
)
with check (
  exists (
    select 1
    from public.auth_profile() ap
    join public.functions f on f.id = public.function_competencies.function_id
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = f.company_id)
  )
);

drop policy if exists function_competencies_delete on public.function_competencies;
create policy function_competencies_delete on public.function_competencies
for delete to authenticated
using (
  exists (
    select 1
    from public.auth_profile() ap
    join public.functions f on f.id = public.function_competencies.function_id
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = f.company_id)
  )
);
