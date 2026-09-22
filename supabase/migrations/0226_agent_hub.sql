-- =============================================================
-- Migration 0226 — Agent Hub, phase 1: identity and access
--
-- A system admin can rename an Ask Aimee agent, move it between
-- categories, reorder both, and change who can reach it, without a
-- deploy. That is all this phase does.
--
-- ---- PROMPT CONTENT WILL NEVER LIVE IN THESE TABLES ------------
--
-- Not in phase 1, and not in phase 2 either. This is a design
-- constraint being protected now, while the tables are empty and
-- moving them is free.
--
-- The reason is that a prompt is the agent. Nothing else decides
-- whether it asks one question or eight, or whether it emits a
-- document once or after every exchange, and a prompt edit is
-- invisible in behaviour until a user meets it. The two prompts
-- this product already ships carry byte-SHA guards for exactly that
-- reason (leadership-coach-compose.test.ts, prompt-guard.test.ts),
-- and both have caught real regressions.
--
-- When prompts do become editable in phase 2, they go in a separate
-- `agent_versions` table that is immutable, versioned, and pinned
-- onto a conversation at creation — so an edit cannot change the
-- prompt under a conversation that is already running. Putting a
-- `prompt` column on `agents` would quietly make that impossible,
-- because a mutable column has no version to pin.
--
-- ---- THE HYBRID ------------------------------------------------
--
-- The five registry agents stay the source of truth for their
-- prompt, tools, output cards and base prompt mode: those are code,
-- resolved to server functions and React components, and a row
-- cannot hold them. What a row holds is identity (title,
-- description, category, order) and access.
--
-- `agents.slug` matches the registry id exactly, and
-- `coaching_conversations.practice_id` already stores those ids as
-- text (0132). So no history is rewritten and no conversation
-- changes hands.
--
-- A row whose slug matches no registry entry is IGNORED by the
-- merge in this phase and logged once. Database-defined agents are
-- phase 3; a half-defined one must not reach a picker.
--
-- ---- THE SEED --------------------------------------------------
--
-- Reproduces today exactly. Titles, descriptions, categories,
-- ordering and access are copied from registry.ts and
-- categories.ts as they stand at b7187e9, so the picker after this
-- migration is the picker before it. Any visible difference is a
-- defect rather than a variance, and the PR carries before/after
-- screenshots per role to prove it.
-- =============================================================

-- ---- Categories -----------------------------------------------

create table if not exists public.agent_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  -- Render order. categories.ts ordered by array position, which is
  -- unaddressable from an admin screen; this is the same idea with
  -- a handle on it.
  sort_order integer not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_categories_sort_idx
  on public.agent_categories (sort_order);

drop trigger if exists agent_categories_set_updated_at
  on public.agent_categories;
create trigger agent_categories_set_updated_at
before update on public.agent_categories
for each row execute function public.set_updated_at();

-- ---- Agents ----------------------------------------------------

create table if not exists public.agents (
  id uuid primary key default gen_random_uuid(),
  -- The registry id, verbatim. The join key to code and the value
  -- already sitting in coaching_conversations.practice_id.
  slug text not null unique,
  category_id uuid not null references public.agent_categories(id),
  title text not null,
  description text not null,
  sort_order integer not null default 0,

  -- ---- Access ----
  -- Empty admits every role, matching a registry entry with no
  -- allowedRoles. The three agents that have no role list today
  -- seed empty, so "unset" and "everyone" stay the same thing.
  allowed_roles text[] not null default '{}',
  -- Null means every company. A company feature flag otherwise,
  -- checked against the same catalogue the settings form uses.
  feature text,
  -- Relationships a role list cannot express. The only value
  -- recognised in this phase is 'function_lead', which keeps its
  -- existing implementation (a read of `functions` for a row this
  -- person leads) rather than becoming data.
  access_predicates text[] not null default '{}',
  -- Empty means every company. A non-empty list is an allowlist,
  -- checked in addition to role and feature, never instead of them.
  company_allowlist uuid[] not null default '{}',

  -- Hidden from every picker. Existing conversations are untouched
  -- and keep working: the runtime resolves them through the
  -- registry, which an archived row does not affect.
  archived boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agents_category_sort_idx
  on public.agents (category_id, sort_order);

drop trigger if exists agents_set_updated_at on public.agents;
create trigger agents_set_updated_at
before update on public.agents
for each row execute function public.set_updated_at();

-- ---- Seed: categories, in today's array order ------------------

insert into public.agent_categories (name, slug, sort_order)
values
  ('Communication', 'communication', 0),
  ('Facilitation',  'facilitation',  1),
  ('People',        'people',        2)
on conflict (slug) do nothing;

-- ---- Seed: the five registry agents ----------------------------
--
-- sort_order is position within category, taken from the PRACTICES
-- array order. Titles and descriptions are byte-copies of the
-- registry strings.

insert into public.agents
  (slug, category_id, title, description, sort_order,
   allowed_roles, access_predicates)
select v.slug, c.id, v.title, v.description, v.sort_order,
       v.allowed_roles, v.access_predicates
from (
  values
    (
      'prepare-a-hard-conversation',
      'communication',
      'Prepare a hard conversation',
      'Address issues in a way that invites dialogue instead of defensiveness.',
      0,
      '{}'::text[],
      '{}'::text[]
    ),
    (
      'navigate-emotionally-charged-conversation',
      'communication',
      'Navigate an emotionally charged conversation',
      'Handle a moment where someone is upset or reactive so they feel heard, using the LEAD Model.',
      1,
      '{}'::text[],
      '{}'::text[]
    ),
    (
      'ask-better-questions',
      'facilitation',
      'Ask great questions',
      'Create generative questions that open up thinking and invite ownership.',
      0,
      '{}'::text[],
      '{}'::text[]
    ),
    (
      'functional-chart-builder',
      'people',
      'Functional Chart Builder',
      'Build a clear accountability chart: the functions your business needs, before the people who fill them.',
      0,
      '{company_admin,system_admin,aims_guide}'::text[],
      '{}'::text[]
    ),
    (
      'role-description',
      'people',
      'Role Description Creator',
      'Create downloadable role descriptions that integrate company context like industry, and organizational culture.',
      1,
      '{company_admin,system_admin,aims_guide}'::text[],
      '{function_lead}'::text[]
    )
) as v(slug, category_slug, title, description, sort_order,
       allowed_roles, access_predicates)
join public.agent_categories c on c.slug = v.category_slug
on conflict (slug) do nothing;

-- =============================================================
-- RLS
--
-- READ IS WIDE, and it has to be: every signed-in user renders an
-- agent picker, so every signed-in user must read the titles,
-- descriptions, categories and ordering. That is the whole content
-- of these tables and none of it is sensitive — it is already on
-- screen for anybody who opens Ask Aimee.
--
-- It is also the reason prompts are not here. A prompt column would
-- be readable fleet-wide by this policy, which is a different
-- decision from the one being made, and one nobody would notice
-- being made.
--
-- WRITE IS system_admin ONLY. These tables shape what every company
-- sees; a company_admin editing them would be editing the product.
--
-- Form D throughout: `(select public.auth_role())`, never a bare
-- call, so the helper is evaluated once per statement rather than
-- once per row (0175 measured 2.783ms against 1.360ms at 5000 rows,
-- and a bare wrapper at 954ms). `=` rather than IS NOT DISTINCT
-- FROM: a caller with no role must match nothing.
-- =============================================================

alter table public.agent_categories enable row level security;
alter table public.agent_categories force row level security;
alter table public.agents enable row level security;
alter table public.agents force row level security;

-- ---- agent_categories ----

drop policy if exists agent_categories_select on public.agent_categories;
create policy agent_categories_select on public.agent_categories
for select to authenticated
using (true);

drop policy if exists agent_categories_insert on public.agent_categories;
create policy agent_categories_insert on public.agent_categories
for insert to authenticated
with check ((select public.auth_role()) = 'system_admin');

drop policy if exists agent_categories_update on public.agent_categories;
create policy agent_categories_update on public.agent_categories
for update to authenticated
using ((select public.auth_role()) = 'system_admin')
with check ((select public.auth_role()) = 'system_admin');

drop policy if exists agent_categories_delete on public.agent_categories;
create policy agent_categories_delete on public.agent_categories
for delete to authenticated
using ((select public.auth_role()) = 'system_admin');

-- ---- agents ----

drop policy if exists agents_select on public.agents;
create policy agents_select on public.agents
for select to authenticated
using (true);

drop policy if exists agents_insert on public.agents;
create policy agents_insert on public.agents
for insert to authenticated
with check ((select public.auth_role()) = 'system_admin');

drop policy if exists agents_update on public.agents;
create policy agents_update on public.agents
for update to authenticated
using ((select public.auth_role()) = 'system_admin')
with check ((select public.auth_role()) = 'system_admin');

drop policy if exists agents_delete on public.agents;
create policy agents_delete on public.agents
for delete to authenticated
using ((select public.auth_role()) = 'system_admin');

comment on table public.agents is
  'Identity and access overrides for the code-defined Ask Aimee '
  'agents. Prompts, tools, output cards and base prompt mode stay in '
  'the registry and must never be added here — see 0226 header.';
