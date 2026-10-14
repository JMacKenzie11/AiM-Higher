-- 0273: the action log for outside assistants.
--
-- WHY. Jason, 2026-10-13 (decision 7, the safety list): a log of every
-- action an outside assistant takes, with who, what and when, and limits
-- on how much one person or one company can do in a short time. The
-- limits are counted from this table, so it needs no other store.
--
-- WHAT. One row per MCP tool call: the person, the company the call
-- named (null for a call that names none, such as who_am_i), the
-- assistant's client_id, the tool, the outcome, how many rows came back
-- and how long it took. Never the token, the headers, the arguments'
-- free text or anything returned. Shaped like connection_events (0257).
--
-- WHO WRITES IT. The MCP route, with the service role, after each call.
-- Not the assistant's token: a log the logged party can write is not a
-- log. The token cannot reach this table at all (the gate refuses the
-- path, and 0270's event trigger gives the table assistant_refused at
-- birth), and an ordinary sign-in has no write policy or grant here.
--
-- WHO READS IT. The person (their own rows), a system admin, the
-- company's company_admin, and an assigned guide (is_guide_for, which
-- since 0199 also admits an assigned portfolio_admin: a read, which is
-- wide on purpose). Nothing in the app shows it yet; the Connected
-- assistants page is Phase 4.

create table if not exists public.assistant_actions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  client_id text not null check (char_length(client_id) between 1 and 200),
  tool text not null check (char_length(tool) between 1 and 64),
  outcome text not null check (outcome in ('ok', 'refused', 'error', 'rate_limited')),
  -- A short machine code for a refusal or error, such as
  -- 'company_required' or 'not_open'. Never message text.
  reason text check (reason is null or reason ~ '^[a-z_]{1,64}$'),
  row_count integer check (row_count is null or row_count >= 0),
  duration_ms integer check (duration_ms is null or duration_ms >= 0)
);

-- The two rate-limit counts, and the reads above.
create index if not exists assistant_actions_profile
  on public.assistant_actions (profile_id, created_at desc);
create index if not exists assistant_actions_company
  on public.assistant_actions (company_id, created_at desc)
  where company_id is not null;

comment on table public.assistant_actions is
  'One row per outside-assistant (MCP) tool call: who, which company, which assistant, which tool, the outcome, when (0273). '
  'Written by the MCP route with the service role; never the token, arguments or results.';

alter table public.assistant_actions enable row level security;
alter table public.assistant_actions force row level security;

revoke all on public.assistant_actions from public, anon, authenticated;
grant select on public.assistant_actions to authenticated;
grant select, insert on public.assistant_actions to service_role;

-- Reads: the person's own rows; system_admin; the company's
-- company_admin; an assigned aims_guide or assigned portfolio_admin
-- (is_guide_for). No write policy: only the service role writes.
drop policy if exists assistant_actions_select on public.assistant_actions;
create policy assistant_actions_select on public.assistant_actions
  for select to authenticated
  using (
    profile_id = (select auth.uid())
    or (select public.auth_role()) = 'system_admin'
    or (company_id is not null
        and (((select public.auth_role()) = 'company_admin'
              and (select public.auth_company_id()) = company_id)
             or public.is_guide_for(company_id)))
  );

-- 0270's event trigger has already given the table assistant_refused.
-- Stated again so the file says it, and so it holds if the trigger is
-- ever off when this runs.
drop policy if exists assistant_refused on public.assistant_actions;
create policy assistant_refused on public.assistant_actions
  as restrictive for all to authenticated
  using (not (select public.is_assistant()))
  with check (not (select public.is_assistant()));
