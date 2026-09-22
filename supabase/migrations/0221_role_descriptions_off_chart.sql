-- =============================================================
-- Migration 0221 — a role description can exist off the chart
--
-- The Role Description Builder agent writes documents for roles
-- that are not seats on the Functional Chart. Everything the
-- feature stores today is keyed on function_id, so there was
-- nowhere for such a document to live.
--
-- ---- WHY A PARENT TABLE, AND NOT A NULLABLE function_id -----
--
-- The obvious move is to drop NOT NULL on
-- role_description_versions.function_id and call an off-chart role
-- one with a null. It fails three ways at once, and all three are
-- silent:
--
--   1. version_number is sequenced by the unique index
--      (function_id, version_number). Postgres treats NULLs as
--      DISTINCT, so that index stops constraining anything the
--      moment function_id is null: every off-chart save could
--      write version 1 and the index would allow it.
--   2. Nothing says two saves are the same role. A role's history
--      IS its function_id today, and an off-chart role has no
--      identity at all.
--   3. "Newest version per role", which is what /roles lists,
--      has nothing to group an off-chart row by.
--
-- So a role gets a row. role_descriptions is one row per ROLE:
-- the seat it holds (or null, meaning off the chart), its title,
-- and the functions an off-chart role supports. Versions hang off
-- it. An on-chart role still carries function_id, so every
-- function-keyed read in the app keeps working.
--
-- ---- EXPAND ONLY --------------------------------------------
--
-- Nothing is dropped and nothing is rewritten. function_id stays
-- on role_description_versions beside the new role_id, both
-- populated for an on-chart role, because every existing reader
-- queries by function_id and this migration is not the one that
-- changes them. Contracting that column is a later instruction.
--
-- role_description_documents is untouched. It is the generation
-- cache for the Sonnet path, one row per function, and the agent
-- does not write it.
--
-- ---- ON DELETE ----------------------------------------------
--
-- function_id is `on delete cascade`, matching 0127 and 0129
-- exactly: deleting a function already takes its role description
-- documents and versions with it, and the confirmation on the
-- chart already spells the cascade out. Whether a saved document
-- should instead survive its function as an off-chart role is a
-- real question and a behaviour change, so it is not decided here.
-- =============================================================

-- ---- The role ------------------------------------------------

create table if not exists public.role_descriptions (
  id uuid primary key default gen_random_uuid(),
  -- The RLS key, held directly rather than reached through
  -- functions. A null function_id cannot be joined to a company,
  -- which is the whole reason this column exists.
  company_id uuid not null references public.companies(id) on delete cascade,
  -- Null means the role is not a seat on the chart. That is a
  -- recorded choice, not missing data.
  function_id uuid references public.functions(id) on delete cascade,
  title text not null,
  -- Titles of the functions an off-chart role supports. An empty
  -- array is the answer "none", which the agent asks for
  -- explicitly, so the column is NOT NULL with a default rather
  -- than nullable.
  supports_functions jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists role_descriptions_company_idx
  on public.role_descriptions (company_id);

create index if not exists role_descriptions_function_idx
  on public.role_descriptions (function_id);

-- One role row per function, so a second save against a seat
-- extends that seat's history rather than starting a rival one.
-- Partial, because off-chart roles all carry a null function_id
-- and must not collide with each other.
create unique index if not exists role_descriptions_function_unique_idx
  on public.role_descriptions (function_id)
  where function_id is not null;

drop trigger if exists role_descriptions_set_updated_at
  on public.role_descriptions;
create trigger role_descriptions_set_updated_at
before update on public.role_descriptions
for each row execute function public.set_updated_at();

-- ---- Versions gain a parent, a body, and a provenance --------

alter table public.role_description_versions
  add column if not exists role_id uuid
    references public.role_descriptions(id) on delete cascade;

alter table public.role_description_versions
  add column if not exists company_id uuid
    references public.companies(id) on delete cascade;

-- The document in the agent card's shape. Deliberately NOT
-- snapshot_document: that column holds the Sonnet generator's
-- RdDocument and still does, so a row says which of the two wrote
-- it by which column is populated.
alter table public.role_description_versions
  add column if not exists body_json jsonb;

-- Where a document came from. Provenance only: nothing reads it
-- for access, and a deleted conversation leaves the document
-- standing.
alter table public.role_description_versions
  add column if not exists source_conversation_id uuid
    references public.coaching_conversations(id) on delete set null;

create index if not exists role_description_versions_source_conversation_idx
  on public.role_description_versions (source_conversation_id);

-- ---- Backfill ------------------------------------------------
--
-- Every function that already has a published version gets a role
-- row, so today's documents appear on /roles beside tomorrow's and
-- the new column is NOT NULL by the end of this migration rather
-- than "NOT NULL for rows written after Tuesday".
--
-- Idempotent: the partial unique index above makes the insert a
-- no-op on a re-run, and the updates only touch nulls.

insert into public.role_descriptions (company_id, function_id, title, created_by)
select distinct on (f.id)
  f.company_id,
  f.id,
  f.title,
  v.published_by
from public.role_description_versions v
join public.functions f on f.id = v.function_id
where v.function_id is not null
  and not exists (
    select 1 from public.role_descriptions rd where rd.function_id = f.id
  )
order by f.id, v.version_number desc;

update public.role_description_versions v
set role_id = rd.id
from public.role_descriptions rd
where v.role_id is null
  and v.function_id is not null
  and rd.function_id = v.function_id;

update public.role_description_versions v
set company_id = f.company_id
from public.functions f
where v.company_id is null
  and v.function_id = f.id;

-- Any version still unparented has lost its function to a cascade
-- mid-migration, which the FK makes impossible, or arrived from a
-- path that does not exist yet. Neither can be made NOT NULL
-- honestly, so the constraints below are added only if the
-- backfill left nothing behind.
do $$
begin
  if exists (
    select 1 from public.role_description_versions
    where role_id is null or company_id is null
  ) then
    raise exception
      'role_description_versions has % unparented row(s); backfill did not complete',
      (select count(*) from public.role_description_versions
        where role_id is null or company_id is null);
  end if;

  alter table public.role_description_versions
    alter column role_id set not null;
  alter table public.role_description_versions
    alter column company_id set not null;
  -- An off-chart version has no function. The identity that
  -- sequences versions is role_id from here on, which is why the
  -- index below replaces the function-keyed one as the constraint
  -- that matters.
  alter table public.role_description_versions
    alter column function_id drop not null;
end $$;

create unique index if not exists role_description_versions_role_version_idx
  on public.role_description_versions (role_id, version_number);

create index if not exists role_description_versions_role_published_idx
  on public.role_description_versions (role_id, published_at desc);

-- =============================================================
-- is_assigned_guide_for — the guide test, without the portfolio arm
--
-- 0199 folded portfolio_admin into is_admin_for and redefined
-- is_guide_for as a wrapper over it, so the ~117 policies naming
-- the old helper now admit an assigned portfolio_admin as well.
-- Its own comment says new policies should call is_admin_for
-- directly.
--
-- For a READ that is right, and the selects below do call it: a
-- portfolio_admin's reach is instance-wide read by design.
--
-- For a WRITE it is not. CLAUDE.md closes the list of tables where
-- portfolio_admin may hold a write policy at four — companies,
-- company_features, profiles, portfolio_admin_events — and these
-- are not among them. The role is also absent from the agent's own
-- allowedRoles, which is company_admin, system_admin and
-- aims_guide. So the write policies need a predicate that means
-- what is_guide_for used to mean, and this is it: 0111's original
-- body, named for what it actually tests.
--
-- It does NOT touch is_guide_for. Redefining a helper 117 policies
-- depend on is a fleet-wide semantic change and belongs in its own
-- migration, with its own probes and Jason's timing.
-- =============================================================

create or replace function public.is_assigned_guide_for(target_company_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    join public.guide_assignments ga on ga.guide_id = p.id
    where p.id = auth.uid()
      and p.role = 'aims_guide'
      and ga.company_id = target_company_id
  )
$$;

revoke all on function public.is_assigned_guide_for(uuid) from public;
grant execute on function public.is_assigned_guide_for(uuid) to authenticated;

comment on function public.is_assigned_guide_for(uuid) is
  'True for an aims_guide assigned to this company, and nobody else. '
  'The write-side counterpart to is_admin_for(), which also admits an '
  'assigned portfolio_admin.';

-- =============================================================
-- RLS — role_descriptions
--
-- Read is wide: any member of the company, the way the chart and
-- the existing documents are. Writes are system_admin, the
-- company's own company_admin, and an assigned aims_guide, which
-- is the same list 0127 and 0129 admit and the same list the
-- agent's launcher gates on.
--
-- Shape is 0175's: `(select public.auth_role())`, never a bare
-- call, and `=` rather than `is not distinct from`, so a caller
-- with no company matches nothing.
-- =============================================================

alter table public.role_descriptions enable row level security;
alter table public.role_descriptions force row level security;

drop policy if exists role_descriptions_select on public.role_descriptions;
create policy role_descriptions_select on public.role_descriptions
for select to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_company_id()) is not null
    and (select public.auth_company_id()) = public.role_descriptions.company_id
  )
  or public.is_admin_for(public.role_descriptions.company_id)
);

drop policy if exists role_descriptions_insert on public.role_descriptions;
create policy role_descriptions_insert on public.role_descriptions
for insert to authenticated
with check (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) is not null
    and (select public.auth_company_id()) = public.role_descriptions.company_id
  )
);

drop policy if exists role_descriptions_insert_guide on public.role_descriptions;
create policy role_descriptions_insert_guide on public.role_descriptions
for insert to authenticated
with check (public.is_assigned_guide_for(public.role_descriptions.company_id));

drop policy if exists role_descriptions_update on public.role_descriptions;
create policy role_descriptions_update on public.role_descriptions
for update to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) is not null
    and (select public.auth_company_id()) = public.role_descriptions.company_id
  )
)
with check (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) is not null
    and (select public.auth_company_id()) = public.role_descriptions.company_id
  )
);

drop policy if exists role_descriptions_update_guide on public.role_descriptions;
create policy role_descriptions_update_guide on public.role_descriptions
for update to authenticated
using (public.is_assigned_guide_for(public.role_descriptions.company_id))
with check (public.is_assigned_guide_for(public.role_descriptions.company_id));

drop policy if exists role_descriptions_delete on public.role_descriptions;
create policy role_descriptions_delete on public.role_descriptions
for delete to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) is not null
    and (select public.auth_company_id()) = public.role_descriptions.company_id
  )
);

drop policy if exists role_descriptions_delete_guide on public.role_descriptions;
create policy role_descriptions_delete_guide on public.role_descriptions
for delete to authenticated
using (public.is_assigned_guide_for(public.role_descriptions.company_id));

-- =============================================================
-- RLS — role_description_versions, re-keyed onto company_id
--
-- 0129's policies reach the company by joining function_id to
-- functions. A null function_id joins to nothing, so an off-chart
-- version would be invisible to the person who wrote it — denied
-- rather than leaked, but unreachable all the same.
--
-- Every policy below is 0129's predicate with the join replaced by
-- this table's own company_id. Semantics are unchanged for an
-- on-chart row: the backfill set company_id to exactly the value
-- that join returned.
--
-- INSERT additionally checks the PARENT. company_id alone would
-- let a caller attach a version of their own to another company's
-- role: their company_id passes the check, and the row lands in
-- someone else's history. Reading it back is still denied, but the
-- history is corrupt, which is worse than a denial. The subquery
-- is one row on insert and costs nothing.
-- =============================================================

drop policy if exists role_description_versions_select
  on public.role_description_versions;
create policy role_description_versions_select
  on public.role_description_versions
for select to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_company_id()) is not null
    and (select public.auth_company_id()) = public.role_description_versions.company_id
  )
  or public.is_admin_for(public.role_description_versions.company_id)
);

drop policy if exists role_description_versions_insert
  on public.role_description_versions;
create policy role_description_versions_insert
  on public.role_description_versions
for insert to authenticated
with check (
  (
    (select public.auth_role()) = 'system_admin'
    or (
      (select public.auth_role()) = 'company_admin'
      and (select public.auth_company_id()) is not null
      and (select public.auth_company_id()) = public.role_description_versions.company_id
    )
  )
  and exists (
    select 1 from public.role_descriptions rd
    where rd.id = public.role_description_versions.role_id
      and rd.company_id = public.role_description_versions.company_id
  )
);

drop policy if exists role_description_versions_insert_guide
  on public.role_description_versions;
create policy role_description_versions_insert_guide
  on public.role_description_versions
for insert to authenticated
with check (
  public.is_assigned_guide_for(public.role_description_versions.company_id)
  and exists (
    select 1 from public.role_descriptions rd
    where rd.id = public.role_description_versions.role_id
      and rd.company_id = public.role_description_versions.company_id
  )
);

drop policy if exists role_description_versions_delete
  on public.role_description_versions;
create policy role_description_versions_delete
  on public.role_description_versions
for delete to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) is not null
    and (select public.auth_company_id()) = public.role_description_versions.company_id
  )
);

drop policy if exists role_description_versions_delete_guide
  on public.role_description_versions;
create policy role_description_versions_delete_guide
  on public.role_description_versions
for delete to authenticated
using (public.is_assigned_guide_for(public.role_description_versions.company_id));

-- Still no update policy. Versions remain immutable snapshots:
-- Save writes a new one and never overwrites.
