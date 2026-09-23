-- =============================================================
-- Migration 0231 — one authoring instance, everywhere else read-only
--
-- Phase 4a/4b gave a distributed agent a read-only life on the
-- instance that received it: `managed_from` non-null, and the
-- policies in 0230 refuse a local admin's write. That covered an
-- agent that ARRIVED from somewhere. It did not cover the five that
-- were already there.
--
-- ---- WHAT WENT WRONG -------------------------------------------
--
-- 0226 seeds five agents, and migrations run fleet-wide, so EVERY
-- instance seeds its own five with managed_from null. A client
-- instance therefore has five agents its admins can rename, re-scope
-- and republish, drifting from HQ's, and a push from HQ is refused
-- against them with "already exists here and was created here".
--
-- Measured on the one client instance before writing this: all five
-- rows have zero agent_versions, a null live pointer, a null draft
-- pointer, and updated_at equal to created_at to the microsecond.
-- Nothing had been authored there. But nothing STOPPED it, and the
-- next instance provisioned gets the same five and the same gap.
--
-- ---- THE RULE --------------------------------------------------
--
-- Agents are authored in exactly one place. Every other instance
-- runs what it is given and cannot write to the agent tables at all
-- — not a new agent, not a rename, not a version, not a reorder.
--
-- ---- HOW A DATABASE KNOWS WHICH IT IS --------------------------
--
-- It cannot be derived. A migration runs identically everywhere, so
-- it cannot mark one instance and not another, and the registry that
-- knows the difference lives on the control plane, which a client
-- instance cannot read. So the fact has to be STORED, once, per
-- database.
--
-- It defaults to FALSE, and that polarity is the point. A newly
-- provisioned instance is read-only from the moment its migrations
-- run, with nobody having to remember a step. The failure mode of
-- forgetting is "the Hub is read-only on HQ", which is visible in
-- seconds and reversible in one statement. The opposite default
-- fails silently, on a customer's instance, in the direction of
-- letting writes through.
--
-- ---- WHY POLICIES AND NOT PRIVILEGES HERE ----------------------
--
-- E8 says a verb withheld beats a policy omitted, and 0228/0230
-- follow it for agent_versions. This migration deliberately does NOT
-- revoke the table privileges, because service_role must keep
-- writing `agents` and `agent_categories` on a RECEIVING instance:
-- that is how a push lands. service_role carries BYPASSRLS, so a
-- policy stops the signed-in local admin and leaves the distribution
-- path open, which is exactly the split we want. Revoking the
-- privilege would close both doors and break distribution.
--
-- agent_versions keeps its 0228 shape: the privilege stays revoked
-- from service_role and the single SECURITY DEFINER door in 0230 is
-- how a distributed version is written. Nothing here loosens it.
-- =============================================================

-- ---- 1. The fact -----------------------------------------------

create table if not exists public.instance_settings (
  -- Singleton. The check plus the primary key means a second row is
  -- rejected by the database rather than by everyone remembering.
  singleton boolean primary key default true check (singleton),
  is_primary boolean not null default false,
  updated_at timestamptz not null default now()
);

comment on table public.instance_settings is
  'One row. Facts about THIS deployment that no migration can derive, '
  'because a migration runs identically on every instance.';

comment on column public.instance_settings.is_primary is
  'True on the single authoring instance. False everywhere else, and '
  'false by default, so a newly provisioned instance is read-only '
  'before anybody decides anything. Set by scripts/mark-primary.ts.';

insert into public.instance_settings (singleton, is_primary)
values (true, false)
on conflict (singleton) do nothing;

alter table public.instance_settings enable row level security;
alter table public.instance_settings force row level security;

-- Readable by anyone signed in. It is one boolean about the
-- deployment, not about a tenant, and the Hub needs it to decide
-- what to render. Nothing to scope.
drop policy if exists instance_settings_select on public.instance_settings;
create policy instance_settings_select on public.instance_settings
for select to authenticated
using (true);

-- No write policy, and the write VERBS withheld to match — E8. A
-- signed-in system admin must not be able to promote their own
-- instance to the authoring one, which is what any write path here
-- would amount to.
revoke all on public.instance_settings from public;
revoke all on public.instance_settings from anon;
revoke all on public.instance_settings from authenticated;
revoke all on public.instance_settings from service_role;

grant select on public.instance_settings to authenticated;
-- update, so scripts/mark-primary.ts can flip it with the service
-- key. NOT insert and NOT delete: the singleton row is created by
-- this migration and no code gets to remove or replace it.
grant select, update on public.instance_settings to service_role;

-- ---- 2. The helper ---------------------------------------------
--
-- security definer so a policy does not depend on the caller being
-- able to read the table, and stable so it is evaluated once per
-- statement rather than once per row. Same shape as the helpers in
-- 0151 and 0230: fixed search_path, revoked from public, granted to
-- exactly the roles that need it.
--
-- coalesce to FALSE. A missing row means read-only, not open.

create or replace function public.is_primary_instance()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select is_primary from public.instance_settings where singleton limit 1),
    false
  );
$$;

revoke all on function public.is_primary_instance() from public;
revoke all on function public.is_primary_instance() from anon;
grant execute on function public.is_primary_instance() to authenticated;
grant execute on function public.is_primary_instance() to service_role;

comment on function public.is_primary_instance() is
  'Is this database the authoring instance? False unless explicitly '
  'set, so an unconfigured instance is read-only.';

-- ---- 3. agents --------------------------------------------------
--
-- Form D throughout: `(select public.fn())`, never a bare call.
-- 0230's managed_from conditions are kept verbatim and the new
-- condition is added beside them; both must hold.

drop policy if exists agents_insert on public.agents;
create policy agents_insert on public.agents
for insert to authenticated
with check (
  (select public.auth_role()) = 'system_admin'
  and managed_from is null
  and (select public.is_primary_instance())
);

drop policy if exists agents_update on public.agents;
create policy agents_update on public.agents
for update to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  and managed_from is null
  and (select public.is_primary_instance())
)
with check (
  (select public.auth_role()) = 'system_admin'
  and managed_from is null
  and (select public.is_primary_instance())
);

drop policy if exists agents_delete on public.agents;
create policy agents_delete on public.agents
for delete to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  and managed_from is null
  and (select public.is_primary_instance())
);

-- SELECT stays wide, for the reason 0230 gave: a receiving
-- instance's admins must SEE their agents, and every signed-in user
-- reads this table to render a picker.

-- ---- 4. agent_categories ----------------------------------------
--
-- Categories are structure the Hub edits, so they follow the agents.
-- Left alone, a local admin could not rename an agent but could
-- rename the heading it sits under, which is the same drift wearing
-- a hat.

drop policy if exists agent_categories_insert on public.agent_categories;
create policy agent_categories_insert on public.agent_categories
for insert to authenticated
with check (
  (select public.auth_role()) = 'system_admin'
  and (select public.is_primary_instance())
);

drop policy if exists agent_categories_update on public.agent_categories;
create policy agent_categories_update on public.agent_categories
for update to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  and (select public.is_primary_instance())
)
with check (
  (select public.auth_role()) = 'system_admin'
  and (select public.is_primary_instance())
);

drop policy if exists agent_categories_delete on public.agent_categories;
create policy agent_categories_delete on public.agent_categories
for delete to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  and (select public.is_primary_instance())
);

-- ---- 5. agent_versions ------------------------------------------
--
-- The one-way reference into `agents` is kept exactly as 0230 wrote
-- it, warning and all: no policy on `agents` mentions
-- agent_versions, so there is no pair to cycle. If one is ever
-- added, this is the policy that will recurse.

drop policy if exists agent_versions_insert on public.agent_versions;
create policy agent_versions_insert on public.agent_versions
for insert to authenticated
with check (
  (select public.auth_role()) = 'system_admin'
  and (select public.is_primary_instance())
  and exists (
    select 1
    from public.agents a
    where a.id = agent_id
      and a.managed_from is null
  )
);

-- Still no UPDATE policy and no DELETE policy on agent_versions, and
-- those verbs are still granted to nobody. 0228's immutability is
-- untouched by this migration.
