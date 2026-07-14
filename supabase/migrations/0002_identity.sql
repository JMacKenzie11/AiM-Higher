-- =============================================================
-- Phase 2 — Migration 0002: identity & tenancy (Section 4.1).
--   companies · profiles · invitations
-- All three tables carry RLS in 0004_rls.sql; do not skip that step.
-- =============================================================

-- ---- companies ------------------------------------------------
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'America/Anchorage',
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- timezone lives on companies so the weekly review can compute
-- "this Friday" in the company's clock (Section 8.4). Default matches
-- the first client per the spec.

create trigger companies_set_updated_at
before update on public.companies
for each row execute function public.set_updated_at();

-- ---- profiles (1:1 with auth.users) --------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  full_name text not null,
  position text,
  role text not null default 'team_member'
    check (role in ('system_admin','company_admin','team_member')),
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Only a system_admin may have a null company; everyone else must belong to one.
  constraint profiles_role_requires_company
    check (role = 'system_admin' or company_id is not null)
);

create index profiles_company_id_idx on public.profiles (company_id);
create index profiles_role_idx on public.profiles (role);

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- ---- invitations ---------------------------------------------
create table public.invitations (
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

create unique index invitations_pending_unique
  on public.invitations (company_id, lower(email))
  where status = 'pending';
create index invitations_company_id_idx on public.invitations (company_id);
create index invitations_token_idx on public.invitations (token);
create index invitations_email_idx on public.invitations (lower(email));

create trigger invitations_set_updated_at
before update on public.invitations
for each row execute function public.set_updated_at();
