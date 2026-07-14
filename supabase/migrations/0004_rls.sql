-- =============================================================
-- Phase 2 — Migration 0004: RLS helper + policies for identity + quarters.
--   Every table gets RLS enabled and the four policies from Section 5.
--   The auth_profile() helper is SECURITY DEFINER so it doesn't recurse
--   through the profiles policies when called from a profiles policy.
-- =============================================================

-- ---- RLS helper -----------------------------------------------
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

-- Enable RLS on every table in this migration set.
alter table public.companies   enable row level security;
alter table public.profiles    enable row level security;
alter table public.invitations enable row level security;
alter table public.quarters    enable row level security;

-- Defensive: prevent RLS-bypass by table owner. The service_role
-- bypasses RLS via GRANT anyway; authenticated / anon must go through policies.
alter table public.companies   force row level security;
alter table public.profiles    force row level security;
alter table public.invitations force row level security;
alter table public.quarters    force row level security;

-- =============================================================
-- companies
-- =============================================================
-- select: system_admin sees all; anyone else sees their own company.
create policy companies_select on public.companies
for select to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or ap.company_id = public.companies.id
  )
);

-- insert / update / delete: system_admin only.
create policy companies_insert on public.companies
for insert to authenticated
with check (exists (select 1 from public.auth_profile() ap where ap.role = 'system_admin'));

create policy companies_update on public.companies
for update to authenticated
using (exists (select 1 from public.auth_profile() ap where ap.role = 'system_admin'))
with check (exists (select 1 from public.auth_profile() ap where ap.role = 'system_admin'));

create policy companies_delete on public.companies
for delete to authenticated
using (exists (select 1 from public.auth_profile() ap where ap.role = 'system_admin'));

-- =============================================================
-- profiles
-- =============================================================
-- select: system_admin all; others limited to profiles in their own company.
--   The self-row is always visible because every user's profile has
--   company_id matching auth_profile().company_id (or role=system_admin).
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

-- insert: system_admin any; company_admin same-company non-system roles.
--   Note: the accept-invite server action inserts via service role and
--   bypasses this. The policy still protects direct client-side inserts.
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

-- update — three orthogonal cases, one policy each:
--   1. Self: allowed as long as role and company assignment do not change.
--      Column-level restriction to name/position lives in the server action.
create policy profiles_update_self on public.profiles
for update to authenticated
using (public.profiles.id = auth.uid())
with check (
  public.profiles.id = auth.uid()
  and public.profiles.role = (select ap.role from public.auth_profile() ap)
  and public.profiles.company_id is not distinct from (select ap.company_id from public.auth_profile() ap)
);

--   2. company_admin: same-company, non-self, may not grant system_admin.
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

--   3. system_admin: unrestricted.
create policy profiles_update_system_admin on public.profiles
for update to authenticated
using (exists (select 1 from public.auth_profile() ap where ap.role = 'system_admin'))
with check (exists (select 1 from public.auth_profile() ap where ap.role = 'system_admin'));

-- delete: system_admin any; company_admin same-company non-self.
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

-- =============================================================
-- invitations
-- =============================================================
-- Admins of the target company (or system_admin) can select/insert/update/delete.
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

-- =============================================================
-- quarters
-- =============================================================
-- select: company members read own company; system_admin all.
create policy quarters_select on public.quarters
for select to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.company_id is not null and ap.company_id = public.quarters.company_id)
  )
);

-- insert / update / delete: company_admin (own company) or system_admin.
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
