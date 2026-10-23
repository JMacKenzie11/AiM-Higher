-- =============================================================
-- Migration 0298: the Capacity Diagnostic's systems and AI use (phase 4)
--
-- WHY. Jason, 2026-10-23 (Capacity Diagnostic module: Phase 4, systems
-- and AI use): a map of the client's systems and how information moves
-- between them, a record of how each participant uses AI today, and
-- the Systems and AI Snapshot that takes the Guardrails section's place
-- in the readout.
--
-- ADDITIVE ONLY. Three new tables and four new nullable or defaulted
-- columns. No existing column, constraint or policy changes.
--
--   diagnostic_systems       one system the client uses
--   diagnostic_system_links  one way information moves between two of
--                            them, and how
--   diagnostic_ai_use        one AI tool one participant uses for work
--   diagnostic_tasks         system_id (where the task happens) and the
--                            pair copies_from_system_id and
--                            copies_to_system_id (both or neither)
--   diagnostic_participants  uses_no_ai: "none" is an answer, so an
--                            empty list can mean not yet asked
--
-- SAME DIAGNOSTIC. A link's two ends and a task's three systems must
-- belong to the row's own diagnostic. assert_diagnostic_system_same_
-- diagnostic() refuses anything else, on the model of
-- assert_priority_parent_same_company (0209).
--
-- DELETES (Jason, 2026-10-23). A link and an AI row can be deleted, so
-- a mistake can be taken back and "None" can clear a person's tools. A
-- system can be deleted only while nothing points at it: every
-- reference is ON DELETE RESTRICT, so a task never loses one half of
-- its copy pair.
--
-- ACCESS. The same as the eight tables in 0294: system admin only, for
-- every verb granted, in the hoisted form; 0295's primary-instance rule
-- on each; authorship stamped by stamp_created_by(); outside assistants
-- refused from birth by 0270's event trigger; nothing granted to anon;
-- nothing written by the service role.
--
-- Harness probe "diagnostics · system admin only", extended to the
-- three tables and the same-diagnostic rule.
-- =============================================================

-- ---- Systems -----------------------------------------------------

create table if not exists public.diagnostic_systems (
  id uuid primary key default gen_random_uuid(),
  diagnostic_id uuid not null references public.diagnostics(id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 200),
  kind text not null default 'other' check (kind in (
    'erp', 'accounting', 'crm', 'quoting', 'scheduling', 'email', 'spreadsheet', 'file_storage', 'other'
  )),
  holds text check (holds is null or length(holds) <= 2000),
  owner_name text check (owner_name is null or length(owner_name) <= 200),
  notes text check (notes is null or length(notes) <= 4000),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists diagnostic_systems_diagnostic on public.diagnostic_systems (diagnostic_id);

comment on table public.diagnostic_systems is
  'Capacity Diagnostic (0298): one system the client uses, from the systems walkthrough. System admins only.';

-- ---- Links -------------------------------------------------------

create table if not exists public.diagnostic_system_links (
  id uuid primary key default gen_random_uuid(),
  diagnostic_id uuid not null references public.diagnostics(id) on delete restrict,
  from_system_id uuid not null references public.diagnostic_systems(id) on delete restrict,
  to_system_id uuid not null references public.diagnostic_systems(id) on delete restrict,
  what_moves text not null check (length(btrim(what_moves)) between 1 and 300),
  how text not null default 'unknown' check (how in ('retyped', 'export_import', 'automatic', 'unknown')),
  -- What breaks or gets missed (walkthrough question 4).
  notes text check (notes is null or length(notes) <= 4000),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (from_system_id <> to_system_id),
  unique (from_system_id, to_system_id, what_moves)
);

create index if not exists diagnostic_system_links_diagnostic on public.diagnostic_system_links (diagnostic_id);

comment on table public.diagnostic_system_links is
  'Capacity Diagnostic (0298): one way information moves from one system to another, and how. System admins only.';

-- ---- AI use ------------------------------------------------------

create table if not exists public.diagnostic_ai_use (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.diagnostic_participants(id) on delete restrict,
  tool text not null check (length(btrim(tool)) between 1 and 200),
  provided_by text check (provided_by is null or provided_by in ('company', 'personal')),
  used_for text check (used_for is null or length(used_for) <= 2000),
  frequency text check (frequency is null or frequency in ('daily', 'weekly', 'monthly', 'rarely')),
  never_share text check (never_share is null or length(never_share) <= 2000),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists diagnostic_ai_use_participant on public.diagnostic_ai_use (participant_id);

comment on table public.diagnostic_ai_use is
  'Capacity Diagnostic (0298): one AI tool one participant uses for work. The owner sees counts and tool names only. System admins only.';

-- ---- New columns -------------------------------------------------

alter table public.diagnostic_tasks
  add column if not exists system_id uuid references public.diagnostic_systems(id) on delete restrict,
  add column if not exists copies_from_system_id uuid references public.diagnostic_systems(id) on delete restrict,
  add column if not exists copies_to_system_id uuid references public.diagnostic_systems(id) on delete restrict;

alter table public.diagnostic_tasks
  drop constraint if exists diagnostic_tasks_copy_pair;
alter table public.diagnostic_tasks
  add constraint diagnostic_tasks_copy_pair check (
    (copies_from_system_id is null) = (copies_to_system_id is null)
    and (copies_from_system_id is null or copies_from_system_id <> copies_to_system_id)
  );

alter table public.diagnostic_participants
  add column if not exists uses_no_ai boolean not null default false;

-- ---- Same diagnostic ---------------------------------------------

create or replace function public.assert_diagnostic_system_same_diagnostic()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ids uuid[];
  s uuid;
  owner uuid;
begin
  if tg_table_name = 'diagnostic_system_links' then
    ids := array[new.from_system_id, new.to_system_id];
  else
    ids := array[new.system_id, new.copies_from_system_id, new.copies_to_system_id];
  end if;
  foreach s in array ids loop
    continue when s is null;
    select diagnostic_id into owner from public.diagnostic_systems where id = s;
    if owner is null then
      raise exception 'diagnostic_system_missing: system % not found', s using errcode = '23503';
    end if;
    if owner <> new.diagnostic_id then
      raise exception 'diagnostic_system_cross_diagnostic: system % belongs to another diagnostic', s
        using errcode = '23514';
    end if;
  end loop;
  return new;
end;
$$;

revoke all on function public.assert_diagnostic_system_same_diagnostic() from public, anon, authenticated;

drop trigger if exists diagnostic_system_links_same_diagnostic on public.diagnostic_system_links;
create trigger diagnostic_system_links_same_diagnostic
  before insert or update on public.diagnostic_system_links
  for each row execute function public.assert_diagnostic_system_same_diagnostic();

drop trigger if exists diagnostic_tasks_system_same_diagnostic on public.diagnostic_tasks;
create trigger diagnostic_tasks_system_same_diagnostic
  before insert or update of system_id, copies_from_system_id, copies_to_system_id, diagnostic_id on public.diagnostic_tasks
  for each row execute function public.assert_diagnostic_system_same_diagnostic();

-- ---- Grants, row security, authorship ----------------------------

do $$
declare t text;
begin
  foreach t in array array['diagnostic_systems', 'diagnostic_system_links', 'diagnostic_ai_use'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop trigger if exists stamp_created_by on public.%I', t);
    execute format(
      'create trigger stamp_created_by before insert on public.%I for each row execute function public.stamp_created_by()',
      t
    );
    -- Roles: system_admin only, for every verb granted.
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select public.auth_role()) = ''system_admin'')',
      t || '_select', t
    );
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select public.auth_role()) = ''system_admin'')',
      t || '_insert', t
    );
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select public.auth_role()) = ''system_admin'') with check ((select public.auth_role()) = ''system_admin'')',
      t || '_update', t
    );
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using ((select public.auth_role()) = ''system_admin'')',
      t || '_delete', t
    );
    -- HQ only (0295): every verb, restrictive.
    execute format('drop policy if exists %I on public.%I', t || '_primary_only', t);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated using ((select public.is_primary_instance())) with check ((select public.is_primary_instance()))',
      t || '_primary_only', t
    );
  end loop;
end $$;
