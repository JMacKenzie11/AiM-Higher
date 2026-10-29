-- =============================================================
-- Migration 0306: a Capacity Diagnostic client's automations
--
-- WHY. Jason, 2026-10-29: each client gets a mini project view of the
-- automations being built for them, where each one is (Planned,
-- Building, Testing, Live, Paused), when its build starts and when it
-- goes live (the go-live date is the day it is implemented), who
-- champions it, and the latest update. A system admin keeps it; the
-- client will read it on their own dashboard once client logins exist
-- (a later migration). The first ones come from a diagnostic's first
-- win and 90-day roadmap, and more can be added by hand.
--
-- ADDITIVE ONLY. One new table, and a unique (id, client_id) on
-- diagnostics so an automation's diagnostic can be held to its own
-- client by a foreign key. No existing column, constraint or policy
-- changes.
--
--   diagnostic_automations  one automation for one client, optionally
--                           from one of that client's diagnostics
--
-- SAME CLIENT. diagnostic_id, when set, must be a diagnostic of the
-- row's own client: the composite key (diagnostic_id, client_id)
-- references diagnostics (id, client_id).
--
-- DELETES. An automation can be deleted, so one added by mistake can be
-- taken back. Clients and diagnostics are still never deleted.
--
-- ACCESS. The same as the other diagnostic tables: system admin only,
-- for every verb granted, in the hoisted form; 0295's primary-instance
-- rule; authorship stamped by stamp_created_by(); outside assistants
-- refused from birth by 0270's event trigger; nothing granted to anon;
-- nothing written by the service role.
--
-- Harness probe "diagnostics · system admin only", extended to the new
-- table and the same-client rule.
-- =============================================================

alter table public.diagnostics
  drop constraint if exists diagnostics_id_client_unique;
alter table public.diagnostics
  add constraint diagnostics_id_client_unique unique (id, client_id);

create table if not exists public.diagnostic_automations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.diagnostic_clients(id) on delete restrict,
  diagnostic_id uuid,
  title text not null check (length(btrim(title)) between 1 and 300),
  stage text not null default 'planned' check (stage in ('planned', 'building', 'testing', 'live', 'paused')),
  build_starts date,
  -- The day it is implemented.
  goes_live date,
  champion text check (champion is null or length(champion) <= 200),
  latest_update text check (latest_update is null or length(latest_update) <= 2000),
  latest_update_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (build_starts is null or goes_live is null or goes_live >= build_starts),
  foreign key (diagnostic_id, client_id)
    references public.diagnostics (id, client_id) on delete restrict
);

create index if not exists diagnostic_automations_client on public.diagnostic_automations (client_id);
create index if not exists diagnostic_automations_diagnostic on public.diagnostic_automations (diagnostic_id);

comment on table public.diagnostic_automations is
  'Capacity Diagnostic (0306): one automation built for a client, its stage, build dates, champion and latest update. System admins only.';

-- ---- Grants, row security, authorship ----------------------------

alter table public.diagnostic_automations enable row level security;
alter table public.diagnostic_automations force row level security;
revoke all on public.diagnostic_automations from public, anon, authenticated;
grant select, insert, update, delete on public.diagnostic_automations to authenticated;

drop trigger if exists stamp_created_by on public.diagnostic_automations;
create trigger stamp_created_by before insert on public.diagnostic_automations
  for each row execute function public.stamp_created_by();

-- Roles: system_admin only, for every verb granted.
drop policy if exists diagnostic_automations_select on public.diagnostic_automations;
create policy diagnostic_automations_select on public.diagnostic_automations
  for select to authenticated using ((select public.auth_role()) = 'system_admin');
drop policy if exists diagnostic_automations_insert on public.diagnostic_automations;
create policy diagnostic_automations_insert on public.diagnostic_automations
  for insert to authenticated with check ((select public.auth_role()) = 'system_admin');
drop policy if exists diagnostic_automations_update on public.diagnostic_automations;
create policy diagnostic_automations_update on public.diagnostic_automations
  for update to authenticated
  using ((select public.auth_role()) = 'system_admin')
  with check ((select public.auth_role()) = 'system_admin');
drop policy if exists diagnostic_automations_delete on public.diagnostic_automations;
create policy diagnostic_automations_delete on public.diagnostic_automations
  for delete to authenticated using ((select public.auth_role()) = 'system_admin');

-- Roles: none added. Narrows every role's rules to the primary instance
-- (0295).
drop policy if exists diagnostic_automations_primary_only on public.diagnostic_automations;
create policy diagnostic_automations_primary_only on public.diagnostic_automations
  as restrictive for all to authenticated
  using ((select public.is_primary_instance()))
  with check ((select public.is_primary_instance()));
