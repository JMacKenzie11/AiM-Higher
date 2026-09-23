-- =============================================================
-- Migration 0228 — Agent Hub, phase 2: versioned agent config
--
-- Phase 1 put an agent's IDENTITY in the database. This puts its
-- CONFIG there too: the prompt, the chips, the base mode, the opener,
-- the tools and output card it may use, the token ceiling and the
-- model. Three rules shape everything below.
--
--   1. A config edit never changes a conversation already in flight.
--   2. Nothing goes live implicitly.
--   3. Prompt text is never readable by non-admins.
--
-- ---- 1. VERSIONS ARE PINNED, NOT LOOKED UP ---------------------
--
-- `coaching_conversations.agent_version_id` is stamped once, at
-- creation, from the agent's live pointer. Every later turn reads the
-- config from THAT row. It does not re-read the live pointer, and it
-- does not fall back to it if the pinned version still exists —
-- falling back is the same as not pinning.
--
-- Null means "registry-defined", which is every conversation that
-- exists today and every conversation on an agent that has never been
-- published. So this column needs no backfill and changes no
-- behaviour on landing.
--
-- ---- 2. NOTHING GOES LIVE IMPLICITLY ---------------------------
--
-- `agents` gets two pointers, not one. `draft_version_id` is what
-- editing writes; `live_version_id` is what conversations are stamped
-- from. Only an explicit publish moves the second. A null
-- `live_version_id` means the agent runs from the registry, which is
-- true of all five on the day this lands — so this migration is inert
-- until somebody presses Publish.
--
-- ---- 3. IMMUTABILITY IS A PRIVILEGE, NOT A MISSING POLICY ------
--
-- The instruction for this phase said to model the table on
-- role_description_versions (0129). 0129 is the WRONG model and is
-- named in failure mode E8 as the shape that fails: its entire claim
-- to immutability is the comment "No update policy — versions are
-- immutable snapshots." There is no REVOKE in it. Supabase ships
--
--   alter default privileges in schema public
--     grant all on tables to anon, authenticated, service_role
--
-- so that table arrived with UPDATE already granted to `authenticated`.
-- An UPDATE therefore RUNS; RLS filters every row because no policy
-- admits any; and it reports "0 rows affected" — indistinguishable
-- from a refusal, and one careless policy away from being a rewrite.
--
-- E8's rule is followed here instead, copying 0212 and 0215: revoke
-- from every role BY NAME (the pseudo-role `public` is not a superset
-- of `authenticated`), then grant back exactly the verbs intended.
-- UPDATE and DELETE are granted to nobody, so the statement never
-- runs whatever the policies say, and the probe asserts a
-- statement-level 42501 rather than an empty result.
--
-- ---- WHICH CLIENT READS A PROMPT AT RUNTIME, AND WHY -----------
--
-- Stated here rather than left for somebody to find in a diff.
--
-- Reads of `agent_versions` as `authenticated` are system_admin only,
-- by policy. But every member running a conversation needs the prompt
-- of the version pinned to it, and a member is not a system admin. So
-- the runtime read happens SERVER-SIDE ONLY, in the coach route, on
-- the service-role client, which bypasses RLS.
--
-- That is a deliberate, narrow exception and it is safe only because
-- of where it lives: the service key never reaches a browser, the
-- route returns the model's reply and never the prompt, and the read
-- is by primary key of the version already pinned to the conversation
-- the caller has been authorised for. No API path returns prompt text
-- to a non-admin. `src/lib/practices/version-config.ts` carries the
-- same note at the call site.
-- =============================================================

-- ---- agent_versions --------------------------------------------

create table if not exists public.agent_versions (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  -- Per agent, not global. Version 3 of one agent and version 3 of
  -- another are different things and should read that way.
  version_number integer not null,

  -- ---- the config ----
  -- The prompt IS the agent: nothing else decides whether it asks one
  -- question or eight. Stored whole rather than as a diff, because a
  -- pinned conversation must be able to reproduce its exact text years
  -- later without replaying a chain.
  prompt text not null,
  chips jsonb not null default '[]'::jsonb,
  base_prompt_mode text not null default 'full_coach'
    check (base_prompt_mode in ('full_coach', 'voice_only')),
  skip_setup boolean not null default false,
  first_turn text check (first_turn in ('scripted', 'generate')),
  scripted_opener text,
  -- { fenced-tag -> card-name }. The NAMES of cards the code
  -- implements, never the components: a row cannot hold a React
  -- component, and one that named a card the build does not ship must
  -- fail safe rather than crash a chat.
  output_card jsonb not null default '{}'::jsonb,
  -- Tool TAGS, resolved against the code-defined list at runtime.
  -- Same reasoning as output_card.
  tools text[] not null default '{}',
  max_tokens integer check (max_tokens is null or max_tokens between 256 and 32000),
  model text,

  -- ---- provenance ----
  -- NOT NULL, per the phase instruction, with an empty default so a
  -- DRAFT can exist before anybody has written a note. The
  -- requirement that notes are non-empty belongs to the PUBLISH
  -- action, because that is the moment they mean something: they are
  -- the commit message for a change to what every company's agent
  -- says. A column check could not express "required at publish"
  -- without forbidding drafts.
  publish_notes text not null default '',
  published_by uuid references public.profiles(id) on delete set null,
  published_at timestamptz,

  created_at timestamptz not null default now(),

  unique (agent_id, version_number)
);

create index if not exists agent_versions_agent_idx
  on public.agent_versions (agent_id, version_number desc);

-- NO updated_at, and no set_updated_at trigger. Both would be
-- meaningless on a table nothing can update, and a column that
-- implies mutability on an immutable table is a lie the next reader
-- has to disprove.

-- ---- the two pointers on agents --------------------------------

alter table public.agents
  add column if not exists live_version_id uuid
    references public.agent_versions(id) on delete set null,
  add column if not exists draft_version_id uuid
    references public.agent_versions(id) on delete set null;

comment on column public.agents.live_version_id is
  'The version new conversations are stamped from. Null means this '
  'agent runs from the code registry. Moved only by an explicit '
  'publish.';
comment on column public.agents.draft_version_id is
  'The version the Hub editor is working on. Never read at runtime.';

-- ---- the pin on a conversation ---------------------------------

alter table public.coaching_conversations
  add column if not exists agent_version_id uuid
    references public.agent_versions(id) on delete set null;

comment on column public.coaching_conversations.agent_version_id is
  'The config this conversation runs on, stamped at creation from the '
  'agent''s live_version_id. Null means registry-defined. Never '
  'rewritten by a later publish: that is the whole point of it.';

-- on delete set null rather than cascade or restrict, deliberately.
-- Deleting a version is not something any code path does — nothing
-- holds the DELETE privilege — but if one ever were removed by hand,
-- a conversation must degrade to the registry rather than be deleted
-- along with it.

-- =============================================================
-- RLS and privileges
--
-- SELECT and INSERT: system_admin only, by policy.
-- UPDATE and DELETE: granted to nobody, so they are refused with
-- 42501 before RLS is consulted at all.
-- =============================================================

alter table public.agent_versions enable row level security;
alter table public.agent_versions force row level security;

drop policy if exists agent_versions_select on public.agent_versions;
create policy agent_versions_select on public.agent_versions
for select to authenticated
using ((select public.auth_role()) = 'system_admin');

drop policy if exists agent_versions_insert on public.agent_versions;
create policy agent_versions_insert on public.agent_versions
for insert to authenticated
with check ((select public.auth_role()) = 'system_admin');

-- No update policy and no delete policy. That alone would NOT be
-- enough — see the E8 note in the header — which is what the grants
-- below are for.

revoke all on public.agent_versions from public;
revoke all on public.agent_versions from anon;
revoke all on public.agent_versions from authenticated;
revoke all on public.agent_versions from service_role;

-- authenticated: read and append, both narrowed to system_admin by
-- the policies above.
grant select, insert on public.agent_versions to authenticated;
-- service_role: read only, for the runtime prompt read documented in
-- the header. It gets no INSERT: every write to this table goes
-- through a server action as the signed-in system admin, so the
-- published_by column cannot be anonymous.
grant select on public.agent_versions to service_role;

comment on table public.agent_versions is
  'Immutable, versioned Ask Aimee agent config. Pinned onto a '
  'conversation at creation so a later publish cannot change what a '
  'running conversation says. UPDATE and DELETE are granted to no '
  'role: see the E8 note in migration 0228.';
