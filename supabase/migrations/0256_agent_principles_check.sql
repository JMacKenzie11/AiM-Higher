-- =============================================================
-- Migration 0256: an agent's prompt checked against the AiMS
-- coaching principles before it is published, and the reason kept
-- when it is published anyway
--
-- Part 4 of the coaching principles project (Jason, 2026-09-30 and
-- 2026-10-02). Publishing an agent in the Hub checks its prompt
-- against prompts/aims-coaching-principles.md and lists what pulls the
-- other way (src/lib/practices/principles-check.ts). It warns and
-- never blocks: a system admin can publish with warnings by giving a
-- reason. This keeps both.
--
-- ---- 1. agent_principles_checks ----------------------------------
--
-- One row per check: the agent, fingerprints of the prompt and of the
-- principles it was checked against, what it found (or that it could
-- not run), who ran it and when. The check is a model call, and two
-- calls on the same prompt can word their warnings differently, so
-- publishing does not run its own: it names the check the person read
-- (agent_versions.principles_check_id), and the action refuses a check
-- for a different prompt or an older principles file.
--
-- Access, as for the versions it serves (0228):
--   select   system admins only.
--   insert   system admins only, on the authoring instance (the only
--            place an agent is published), as themselves.
--   update, delete   nobody; the privileges are revoked. A check is a
--            record of what somebody was shown.
--
-- ---- 2. agent_versions ---------------------------------------------
--
-- principles_check_id: the check read before publishing. Null on
-- drafts, on every version published before this, and on versions a
-- push copied in from the authoring instance (the check is kept where
-- the publish happened).
-- principles_reason: why it was published with warnings. The action
-- requires it when the check found something or could not run.
-- Versions stay insert-only; their policies are unchanged.
-- =============================================================

create table if not exists public.agent_principles_checks (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  prompt_sha text not null,
  principles_sha text not null,
  status text not null check (status in ('checked', 'failed')),
  -- [{ principle, quote, why }]: each quote is in the prompt word for
  -- word, each principle a heading of the principles file.
  conflicts jsonb not null default '[]'::jsonb check (jsonb_typeof(conflicts) = 'array'),
  checked_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.agent_principles_checks is
  'An agent prompt checked against the AiMS coaching principles before '
  'publishing (0256). Insert-only; system admins only.';

create index if not exists agent_principles_checks_agent
  on public.agent_principles_checks (agent_id, created_at desc);

alter table public.agent_principles_checks enable row level security;
alter table public.agent_principles_checks force row level security;

revoke all on public.agent_principles_checks from public;
revoke all on public.agent_principles_checks from anon;
revoke all on public.agent_principles_checks from authenticated;
grant select, insert on public.agent_principles_checks to authenticated;

-- Reads: system_admin only.
drop policy if exists agent_principles_checks_select on public.agent_principles_checks;
create policy agent_principles_checks_select on public.agent_principles_checks
  for select to authenticated
  using ((select public.auth_role()) = 'system_admin');

-- Writes: system_admin only, on the authoring instance, as themselves.
drop policy if exists agent_principles_checks_insert on public.agent_principles_checks;
create policy agent_principles_checks_insert on public.agent_principles_checks
  for insert to authenticated
  with check (
    (select public.auth_role()) = 'system_admin'
    and (select public.is_primary_instance())
    and checked_by = (select auth.uid())
  );

alter table public.agent_versions
  add column if not exists principles_check_id uuid
    references public.agent_principles_checks(id) on delete set null,
  add column if not exists principles_reason text
    check (principles_reason is null or length(btrim(principles_reason)) between 1 and 1000);

comment on column public.agent_versions.principles_check_id is
  'The principles check read before this version was published (0256).';
comment on column public.agent_versions.principles_reason is
  'Why it was published although the principles check found something or could not run (0256).';
