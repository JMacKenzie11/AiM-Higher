-- =============================================================
-- Migration 0230 — Agent Hub, phase 4a: distribution
--
-- An agent authored on the main instance can be pushed to chosen
-- instances. One way, primary outward. An edit on a receiving
-- instance is drift, and this migration makes it impossible rather
-- than merely discouraged.
--
-- ---- WHAT THIS MIGRATION DOES NOT DO ---------------------------
--
-- It does not weaken immutability. agent_versions still has NO
-- UPDATE and NO DELETE policy, and those verbs are still granted to
-- nobody. The phase instruction asked for `and managed_from is null`
-- on those policies; there are none to amend, and creating them to
-- "lock them down" would be strictly worse — a policy implies the
-- verb is reachable, and failure mode E8 is precisely that a
-- policy-shaped absence is weaker than a privilege-shaped one. Only
-- the INSERT policy gains the condition.
--
-- ---- THE DOOR FOR FLEET WRITES ---------------------------------
--
-- 0228 withheld INSERT on agent_versions from service_role on
-- purpose, writing down the reason: "every write to this table goes
-- through a server action as the signed-in system admin, so the
-- published_by column cannot be anonymous."
--
-- Distribution needs to write versions on a target instance as the
-- service role, and RLS bypass does not help when the PRIVILEGE is
-- revoked. Granting service_role a blanket INSERT would trade that
-- guarantee away in a footnote, so instead there is exactly one
-- door: insert_distributed_agent_version(), SECURITY DEFINER, which
-- REQUIRES an actor and refuses without one. service_role gets
-- EXECUTE on that function and nothing else; its direct INSERT stays
-- revoked, and the probe asserts both halves — the wall is still
-- proven standing beside the new door.
--
-- Same shape as the helpers in 0151: security definer, fixed
-- search_path, revoked from public, granted to exactly the role that
-- needs it.
-- =============================================================

-- ---- 1. managed_from -------------------------------------------

alter table public.agents
  add column if not exists managed_from text;

comment on column public.agents.managed_from is
  'The subdomain that authored this agent, for one distributed from '
  'another instance. Null for an agent created here. A non-null value '
  'makes the agent read-only to local admins, enforced by the policies '
  'below rather than by the Hub alone.';

-- ---- 2. agents: local admins cannot touch a managed agent -------
--
-- Form D throughout: `(select public.auth_role())`, never a bare
-- call, so the helper is evaluated once per statement rather than
-- once per row.

drop policy if exists agents_insert on public.agents;
create policy agents_insert on public.agents
for insert to authenticated
with check (
  (select public.auth_role()) = 'system_admin'
  and managed_from is null
);

drop policy if exists agents_update on public.agents;
create policy agents_update on public.agents
for update to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  and managed_from is null
)
with check (
  (select public.auth_role()) = 'system_admin'
  and managed_from is null
);

drop policy if exists agents_delete on public.agents;
create policy agents_delete on public.agents
for delete to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  and managed_from is null
);

-- SELECT is unchanged and stays wide. A receiving instance's admins
-- must SEE a managed agent — that is how the Hub shows it as managed
-- from HQ — and every signed-in user reads this table to render a
-- picker.

-- ---- 3. agent_versions: the same rule, through the agent --------
--
-- The policy reaches into `agents` for managed_from. That is the
-- shape behind the recursion incident in 0150/0151, and it is safe
-- here for one reason worth writing down: the reference is ONE WAY.
-- No policy on `agents` mentions agent_versions, so there is no pair
-- to cycle. If one is ever added, this is the policy that will make
-- it recurse, and this comment is the warning.

drop policy if exists agent_versions_insert on public.agent_versions;
create policy agent_versions_insert on public.agent_versions
for insert to authenticated
with check (
  (select public.auth_role()) = 'system_admin'
  and exists (
    select 1
    from public.agents a
    where a.id = agent_id
      and a.managed_from is null
  )
);

-- Still no UPDATE policy and no DELETE policy. See the header.

-- ---- 4. The one door for fleet-managed version writes -----------

create or replace function public.insert_distributed_agent_version(
  target_agent_id uuid,
  v_version_number integer,
  v_prompt text,
  v_chips jsonb,
  v_base_prompt_mode text,
  v_skip_setup boolean,
  v_first_turn text,
  v_scripted_opener text,
  v_tools text[],
  v_max_tokens integer,
  v_model text,
  v_publish_notes text,
  v_actor uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  -- The guarantee 0228 wrote down, kept as a database fact rather
  -- than a convention the caller is trusted to honour: a version row
  -- can never be written without naming a person.
  if v_actor is null then
    raise exception 'insert_distributed_agent_version requires an actor'
      using errcode = 'check_violation';
  end if;

  -- Only for agents that are actually fleet-managed. A local agent's
  -- versions go through the ordinary policy path as the signed-in
  -- admin, and this door must not become a way around it.
  if not exists (
    select 1 from public.agents a
    where a.id = target_agent_id and a.managed_from is not null
  ) then
    raise exception 'insert_distributed_agent_version is only for agents managed from another instance'
      using errcode = 'check_violation';
  end if;

  insert into public.agent_versions (
    agent_id, version_number, prompt, chips, base_prompt_mode,
    skip_setup, first_turn, scripted_opener, output_card, tools,
    max_tokens, model, publish_notes, published_by, published_at
  ) values (
    target_agent_id, v_version_number, v_prompt,
    coalesce(v_chips, '[]'::jsonb), v_base_prompt_mode,
    coalesce(v_skip_setup, false), v_first_turn, v_scripted_opener,
    '{}'::jsonb, coalesce(v_tools, '{}'), v_max_tokens, v_model,
    coalesce(v_publish_notes, ''), v_actor, now()
  )
  -- Idempotent by the constraint 0228 already carries. A retry of a
  -- half-landed push must be a no-op on what landed, so a second
  -- insert of the same version returns the existing row rather than
  -- failing the whole push.
  on conflict (agent_id, version_number) do nothing
  returning id into new_id;

  if new_id is null then
    select id into new_id
    from public.agent_versions
    where agent_id = target_agent_id
      and version_number = v_version_number;
  end if;

  return new_id;
end;
$$;

revoke all on function public.insert_distributed_agent_version(
  uuid, integer, text, jsonb, text, boolean, text, text, text[],
  integer, text, text, uuid
) from public;
revoke all on function public.insert_distributed_agent_version(
  uuid, integer, text, jsonb, text, boolean, text, text, text[],
  integer, text, text, uuid
) from anon;
revoke all on function public.insert_distributed_agent_version(
  uuid, integer, text, jsonb, text, boolean, text, text, text[],
  integer, text, text, uuid
) from authenticated;

-- The only grant. service_role reaches this function and still
-- cannot INSERT the table directly.
grant execute on function public.insert_distributed_agent_version(
  uuid, integer, text, jsonb, text, boolean, text, text, text[],
  integer, text, text, uuid
) to service_role;

-- ---- 5. The distribution log ------------------------------------
--
-- Written on the MAIN instance only. The table exists everywhere
-- because migrations run fleet-wide, which is the same reason every
-- project has an `instances` table and only the control plane's copy
-- is ever read.

create table if not exists public.agent_distributions (
  id uuid primary key default gen_random_uuid(),
  -- The slug, not an agent id: ids are per instance and this row is
  -- about a different instance's copy.
  agent_slug text not null,
  version_number integer,
  target_subdomain text not null,
  targeting text not null default 'all_companies'
    check (targeting in ('all_companies')),
  actor uuid references public.profiles(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  outcome text not null
    check (outcome in ('applied', 'already_current', 'refused', 'failed', 'retracted')),
  detail text not null default ''
);

create index if not exists agent_distributions_agent_idx
  on public.agent_distributions (agent_slug, target_subdomain, started_at desc);

alter table public.agent_distributions enable row level security;
alter table public.agent_distributions force row level security;

drop policy if exists agent_distributions_select on public.agent_distributions;
create policy agent_distributions_select on public.agent_distributions
for select to authenticated
using ((select public.auth_role()) = 'system_admin');

drop policy if exists agent_distributions_insert on public.agent_distributions;
create policy agent_distributions_insert on public.agent_distributions
for insert to authenticated
with check ((select public.auth_role()) = 'system_admin');

-- A receipt is a record of what happened. Nothing rewrites one, so
-- the same privilege discipline as agent_versions applies: the verbs
-- are withheld rather than left to a missing policy. E8.
revoke all on public.agent_distributions from public;
revoke all on public.agent_distributions from anon;
revoke all on public.agent_distributions from authenticated;
revoke all on public.agent_distributions from service_role;

grant select, insert on public.agent_distributions to authenticated;
grant select on public.agent_distributions to service_role;

comment on table public.agent_distributions is
  'Receipts for agent pushes, written on the main instance only. '
  'Append-only: UPDATE and DELETE are granted to no role. See 0230.';
