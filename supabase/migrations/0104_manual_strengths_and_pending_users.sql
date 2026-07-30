-- =============================================================
-- Migration 0104: manual strengths + pending-user roster
--   1. profiles gains 'pending' status and invited_at column
--   2. invitations table dropped; roster is now profiles alone
--   3. user_strengths holds admin/user-entered strengths + superpowers
--      (independent of the strengths_assessment scoring path)
-- =============================================================

-- ---- profiles: allow 'pending', track invite send time ------
alter table public.profiles
  drop constraint if exists profiles_status_check;

alter table public.profiles
  add constraint profiles_status_check
    check (status in ('pending','active','inactive'));

alter table public.profiles
  add column if not exists invited_at timestamptz;

-- ---- drop invitations (roster derives from profiles now) ----
drop policy if exists invitations_select on public.invitations;
drop policy if exists invitations_insert on public.invitations;
drop policy if exists invitations_update on public.invitations;
drop policy if exists invitations_delete on public.invitations;
drop table if exists public.invitations;

-- ---- user_strengths -----------------------------------------
create table public.user_strengths (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('strength','superpower')),
  label text not null check (length(trim(label)) between 1 and 120),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index user_strengths_user_id_idx on public.user_strengths (user_id);
create index user_strengths_user_kind_idx on public.user_strengths (user_id, kind, sort_order);

create trigger user_strengths_set_updated_at
before update on public.user_strengths
for each row execute function public.set_updated_at();

alter table public.user_strengths enable row level security;
alter table public.user_strengths force row level security;

-- select: self, same-company members, or system_admin.
create policy user_strengths_select on public.user_strengths
for select to authenticated
using (
  exists (
    select 1
    from public.auth_profile() ap
    join public.profiles p on p.id = public.user_strengths.user_id
    where ap.role = 'system_admin'
       or ap.uid = public.user_strengths.user_id
       or (ap.company_id is not null and ap.company_id = p.company_id)
  )
);

-- insert: self, same-company company_admin, or system_admin.
create policy user_strengths_insert on public.user_strengths
for insert to authenticated
with check (
  exists (
    select 1
    from public.auth_profile() ap
    join public.profiles p on p.id = public.user_strengths.user_id
    where ap.role = 'system_admin'
       or ap.uid = public.user_strengths.user_id
       or (
         ap.role = 'company_admin'
         and ap.company_id is not null
         and ap.company_id = p.company_id
       )
  )
);

-- update: same rules as insert.
create policy user_strengths_update on public.user_strengths
for update to authenticated
using (
  exists (
    select 1
    from public.auth_profile() ap
    join public.profiles p on p.id = public.user_strengths.user_id
    where ap.role = 'system_admin'
       or ap.uid = public.user_strengths.user_id
       or (
         ap.role = 'company_admin'
         and ap.company_id is not null
         and ap.company_id = p.company_id
       )
  )
)
with check (
  exists (
    select 1
    from public.auth_profile() ap
    join public.profiles p on p.id = public.user_strengths.user_id
    where ap.role = 'system_admin'
       or ap.uid = public.user_strengths.user_id
       or (
         ap.role = 'company_admin'
         and ap.company_id is not null
         and ap.company_id = p.company_id
       )
  )
);

-- delete: same rules as insert.
create policy user_strengths_delete on public.user_strengths
for delete to authenticated
using (
  exists (
    select 1
    from public.auth_profile() ap
    join public.profiles p on p.id = public.user_strengths.user_id
    where ap.role = 'system_admin'
       or ap.uid = public.user_strengths.user_id
       or (
         ap.role = 'company_admin'
         and ap.company_id is not null
         and ap.company_id = p.company_id
       )
  )
);
