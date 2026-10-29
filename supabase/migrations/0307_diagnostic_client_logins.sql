-- =============================================================
-- Migration 0307: Capacity Diagnostic client logins
--
-- WHY. Jason, 2026-10-29: the people at a Capacity Diagnostic client
-- sign in to AiMS HQ at the usual address and see their own client's
-- dashboard, and nothing else in AiMS HQ. One role, several people per
-- client, added only by a system admin inside the diagnostic module.
-- Separate from AiMS HQ companies for now.
--
-- WHAT IT ADDS.
--   profiles                  the role diagnostic_client: a real role
--                             (profiles_role_check), company-less
--                             (profiles_role_requires_company) and
--                             never with a company
--                             (profiles_diagnostic_client_has_no_company),
--                             for the same reason as portfolio_admin
--                             (0190): a company_id would make every
--                             `auth_company_id() = company_id`
--                             predicate in the schema true for one
--                             tenant.
--   diagnostic_client_members one row per such person: the diagnostic
--                             client they belong to. One client each.
--   diagnostic_client_id()    the caller's diagnostic client, or null
--                             for anyone who is not an active
--                             diagnostic_client.
--   portal_client()           the caller's client's name and country,
--                             and nothing else from its row (the row
--                             holds the lead's notes and the owner's
--                             email).
--
-- THE WIDENING, and the only one. A diagnostic_client reads its own
-- client's automations (diagnostic_automations_select_client) and its
-- own membership row. It writes nothing. Every other policy in the
-- schema names the roles it admits, none says "every role but", and the
-- role has no company, so it reaches nothing else; the app agrees
-- (middleware sends it to /portal from every other page, and outside
-- assistants are not open to it, lib/mcp/switch.ts).
--
-- PRIMARY ONLY. The new table carries 0295's restrictive rule, the
-- automations already do, and both functions return nothing off the
-- primary instance.
--
-- Harness probe "diagnostic client · own client only".
-- =============================================================

-- ---- The role ----------------------------------------------------

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('system_admin', 'company_admin', 'team_member',
                  'aims_guide', 'portfolio_admin', 'diagnostic_client'));

alter table public.profiles
  drop constraint if exists profiles_role_requires_company;
alter table public.profiles add constraint profiles_role_requires_company
  check (
    role in ('system_admin', 'aims_guide', 'portfolio_admin', 'diagnostic_client')
    or company_id is not null
  );

alter table public.profiles
  drop constraint if exists profiles_diagnostic_client_has_no_company;
alter table public.profiles add constraint profiles_diagnostic_client_has_no_company
  check (role <> 'diagnostic_client' or company_id is null);

-- ---- Members -----------------------------------------------------

create table if not exists public.diagnostic_client_members (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  client_id uuid not null references public.diagnostic_clients(id) on delete restrict,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists diagnostic_client_members_client on public.diagnostic_client_members (client_id);

comment on table public.diagnostic_client_members is
  'Capacity Diagnostic (0307): the diagnostic client a diagnostic_client person belongs to. System admins write; the person reads their own row.';

-- Only a diagnostic_client can be a member.
create or replace function public.assert_diagnostic_client_member_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = new.profile_id and role = 'diagnostic_client') then
    raise exception 'diagnostic_client_member_role: % is not a diagnostic client', new.profile_id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.assert_diagnostic_client_member_role() from public, anon, authenticated;

drop trigger if exists diagnostic_client_members_role on public.diagnostic_client_members;
create trigger diagnostic_client_members_role
  before insert or update on public.diagnostic_client_members
  for each row execute function public.assert_diagnostic_client_member_role();

alter table public.diagnostic_client_members enable row level security;
alter table public.diagnostic_client_members force row level security;
revoke all on public.diagnostic_client_members from public, anon, authenticated;
grant select, insert, delete on public.diagnostic_client_members to authenticated;

drop trigger if exists stamp_created_by on public.diagnostic_client_members;
create trigger stamp_created_by before insert on public.diagnostic_client_members
  for each row execute function public.stamp_created_by();

-- Roles: system_admin reads every row; a diagnostic_client reads its own.
drop policy if exists diagnostic_client_members_select on public.diagnostic_client_members;
create policy diagnostic_client_members_select on public.diagnostic_client_members
  for select to authenticated
  using ((select public.auth_role()) = 'system_admin' or profile_id = (select auth.uid()));
-- Roles: system_admin only.
drop policy if exists diagnostic_client_members_insert on public.diagnostic_client_members;
create policy diagnostic_client_members_insert on public.diagnostic_client_members
  for insert to authenticated with check ((select public.auth_role()) = 'system_admin');
-- Roles: system_admin only.
drop policy if exists diagnostic_client_members_delete on public.diagnostic_client_members;
create policy diagnostic_client_members_delete on public.diagnostic_client_members
  for delete to authenticated using ((select public.auth_role()) = 'system_admin');

-- Roles: none added. Narrows every role's rules to the primary instance
-- (0295).
drop policy if exists diagnostic_client_members_primary_only on public.diagnostic_client_members;
create policy diagnostic_client_members_primary_only on public.diagnostic_client_members
  as restrictive for all to authenticated
  using ((select public.is_primary_instance()))
  with check ((select public.is_primary_instance()));

-- ---- The caller's client ------------------------------------------

create or replace function public.diagnostic_client_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select m.client_id
  from public.diagnostic_client_members m
  join public.profiles p on p.id = m.profile_id
  where m.profile_id = auth.uid()
    and p.role = 'diagnostic_client'
    and p.status = 'active'
    and public.is_primary_instance()
  limit 1
$$;

revoke all on function public.diagnostic_client_id() from public, anon;
grant execute on function public.diagnostic_client_id() to authenticated;

create or replace function public.portal_client()
returns table (id uuid, name text, country text)
language sql
security definer
stable
set search_path = public
as $$
  select c.id, c.name, c.country
  from public.diagnostic_clients c
  where c.id = public.diagnostic_client_id()
    and c.archived_at is null
$$;

revoke all on function public.portal_client() from public, anon;
grant execute on function public.portal_client() to authenticated;

-- ---- The widening -------------------------------------------------

-- Roles: diagnostic_client, its own client's automations, read only.
-- Permissive beside the system admin's rules (0306); 0306's restrictive
-- primary-only rule still applies.
drop policy if exists diagnostic_automations_select_client on public.diagnostic_automations;
create policy diagnostic_automations_select_client on public.diagnostic_automations
  for select to authenticated
  using (client_id = (select public.diagnostic_client_id()));
