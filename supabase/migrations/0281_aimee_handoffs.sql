-- 0281: an outside assistant hands a topic over to Aimee in AiMS.
--
-- WHY. Jason, 2026-10-14: when someone asks their assistant for help
-- that Aimee handles better (coaching on people or leadership, hard
-- conversations, the functional chart, role descriptions, meeting
-- debriefs), the assistant offers a link that opens Aimee in AiMS with
-- the right agent and the topic. The coaching happens in AiMS, never in
-- the outside assistant.
--
-- WHAT. aimee_handoffs: one row per handoff. The person, the company the
-- request named, the short topic the assistant wrote, and, once opened,
-- the agent chosen and the conversation started. The link carries a
-- short random id; only its SHA-256 is stored, so the table does not
-- hold a usable link either.
--
-- RULES.
--   - An assistant may ADD a handoff, through /api/mcp only, and read
--     nothing: not even its own row back (the route does not need to).
--   - Created, expiry, used and the opened fields are set by the
--     database, never by the request: 24 hours, once.
--   - Opening runs as the signed-in person (claim_aimee_handoff): only
--     the person who asked can open it, once, before it expires. The
--     agent is chosen then, under their own session, by the same list
--     and gate Aimee uses in conversation (lib/aimee/handoff.ts).
--   - The assistant never sees anything back from Aimee: this table has
--     no read for it, and the conversation is ordinary coaching_
--     conversations, which it was always refused.

create table if not exists public.aimee_handoffs (
  id uuid primary key default gen_random_uuid(),
  token_sha256 text not null unique check (token_sha256 ~ '^[0-9a-f]{64}$'),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  topic text not null check (char_length(btrim(topic)) between 1 and 500),
  agent_slug text,
  conversation_id uuid references public.coaching_conversations(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  used_at timestamptz
);

create index if not exists aimee_handoffs_profile on public.aimee_handoffs (profile_id, created_at desc);

comment on table public.aimee_handoffs is
  'A topic an outside assistant handed to Aimee for the signed-in person: opened once, by them, within 24 hours (0281). The link''s id is stored only as a hash.';

-- Roles: none. Stamps the row; admits nobody. Who, when, expiry and the
-- opened fields come from the database, whatever the request said.
create or replace function public.stamp_aimee_handoff()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.profile_id := coalesce(auth.uid(), new.profile_id);
  new.created_at := now();
  new.expires_at := now() + interval '24 hours';
  new.used_at := null;
  new.agent_slug := null;
  new.conversation_id := null;
  return new;
end;
$$;

drop trigger if exists stamp_aimee_handoff on public.aimee_handoffs;
create trigger stamp_aimee_handoff
  before insert on public.aimee_handoffs
  for each row execute function public.stamp_aimee_handoff();

alter table public.aimee_handoffs enable row level security;
alter table public.aimee_handoffs force row level security;

revoke all on public.aimee_handoffs from public, anon, authenticated;
grant insert (token_sha256, company_id, topic) on public.aimee_handoffs to authenticated;
grant select, insert, update, delete on public.aimee_handoffs to service_role;

-- Inserts: the person, for themselves, in a company they can see
-- (companies' own read rule decides). No read, update or delete policy
-- for anyone signed in: opening goes through the two functions below.
drop policy if exists aimee_handoffs_insert on public.aimee_handoffs;
create policy aimee_handoffs_insert on public.aimee_handoffs
  for insert to authenticated
  with check (
    profile_id = (select auth.uid())
    and exists (select 1 from public.companies c where c.id = company_id and c.deleted_at is null)
  );

-- The assistant rules (0270, 0275). 0270's event trigger gave the table
-- assistant_refused at birth; it is on the menu as add-only, so that
-- becomes: an add, nothing else, through the route.
drop policy if exists assistant_refused on public.aimee_handoffs;
-- Roles: none. Restrictive.
drop policy if exists assistant_insert on public.aimee_handoffs;
create policy assistant_insert on public.aimee_handoffs
  as restrictive for insert to authenticated
  with check (not (select public.is_assistant()) or (used_at is null and conversation_id is null and agent_slug is null));
drop policy if exists assistant_no_select on public.aimee_handoffs;
create policy assistant_no_select on public.aimee_handoffs
  as restrictive for select to authenticated
  using (not (select public.is_assistant()));
drop policy if exists assistant_no_update on public.aimee_handoffs;
create policy assistant_no_update on public.aimee_handoffs
  as restrictive for update to authenticated
  using (not (select public.is_assistant())) with check (not (select public.is_assistant()));
drop policy if exists assistant_no_delete on public.aimee_handoffs;
create policy assistant_no_delete on public.aimee_handoffs
  as restrictive for delete to authenticated
  using (not (select public.is_assistant()));
drop policy if exists assistant_through_route on public.aimee_handoffs;
create policy assistant_through_route on public.aimee_handoffs
  as restrictive for all to authenticated
  using (not (select public.is_assistant()) or (select public.assistant_through_route()))
  with check (not (select public.is_assistant()) or (select public.assistant_through_route()));

-- Roles: the signed-in person, for their own handoff only. Opens it:
-- refuses one that is not theirs, used or expired, and otherwise marks
-- it used and returns its company and topic. One statement, so two tabs
-- cannot both open it. Never an assistant (the gate refuses the path
-- too).
create or replace function public.claim_aimee_handoff(p_token text)
returns table (handoff_id uuid, company_id uuid, topic text, state text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  h public.aimee_handoffs;
  hash text := encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
begin
  if public.is_assistant() or auth.uid() is null then
    return query select null::uuid, null::uuid, null::text, 'refused'::text;
    return;
  end if;
  select * into h from public.aimee_handoffs a where a.token_sha256 = hash;
  if not found then
    return query select null::uuid, null::uuid, null::text, 'missing'::text;
  elsif h.profile_id <> auth.uid() then
    return query select null::uuid, null::uuid, null::text, 'not_yours'::text;
  elsif h.used_at is not null then
    return query select null::uuid, null::uuid, null::text, 'used'::text;
  elsif h.expires_at <= now() then
    return query select null::uuid, null::uuid, null::text, 'expired'::text;
  else
    update public.aimee_handoffs a set used_at = now()
     where a.id = h.id and a.used_at is null;
    if not found then
      return query select null::uuid, null::uuid, null::text, 'used'::text;
    else
      return query select h.id, h.company_id, h.topic, 'ok'::text;
    end if;
  end if;
end;
$$;

-- Roles: the signed-in person, for a handoff of theirs they have just
-- opened. Records the agent chosen and the conversation started.
create or replace function public.complete_aimee_handoff(p_id uuid, p_agent text, p_conversation uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.aimee_handoffs
     set agent_slug = nullif(p_agent, ''), conversation_id = p_conversation
   where id = p_id
     and profile_id = auth.uid()
     and used_at is not null
     and conversation_id is null
     and not public.is_assistant()
$$;

revoke all on function public.claim_aimee_handoff(text) from public;
revoke all on function public.complete_aimee_handoff(uuid, text, uuid) from public;
grant execute on function public.claim_aimee_handoff(text) to authenticated;
grant execute on function public.complete_aimee_handoff(uuid, text, uuid) to authenticated;

-- The gate learns one more add: POST /aimee_handoffs. Rebuilt from 0280.
-- Roles: none. Admits nothing; refuses an assistant off the menu, whose
-- session has ended (0272), whose client is not approved (0280), or that
-- did not come through /api/mcp (0275).
create or replace function public.assistant_request_gate()
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  m text;
  p text;
begin
  if not public.is_assistant() then
    return;
  end if;
  if not public.assistant_session_live() then
    raise exception 'assistant_session_ended'
      using errcode = 'PT401',
            hint = 'This assistant''s access was revoked or has expired. Connect it again.';
  end if;
  if not public.assistant_client_trusted(
       nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'client_id') then
    raise exception 'assistant_client_not_approved'
      using errcode = '42501',
            hint = 'This assistant isn''t approved for AiMS.';
  end if;
  if not public.assistant_through_route() then
    raise exception 'assistant_outside_route'
      using errcode = '42501',
            hint = 'An outside assistant reaches AiMS only through its MCP server.';
  end if;
  m := upper(coalesce(current_setting('request.method', true), ''));
  p := rtrim(coalesce(current_setting('request.path', true), ''), '/');
  if m in ('GET', 'HEAD') and p in (
       '/commitments', '/commitment_occurrences', '/issues',
       '/success_measures', '/success_measure_entries', '/success_measure_targets',
       '/functions', '/function_roles', '/function_decision_rights', '/function_competencies',
       '/companies', '/profiles', '/guide_assignments', '/portfolio_assignments',
       '/quarters', '/strategic_focus_areas', '/annual_goals', '/priorities',
       '/company_foundation', '/foundation_items') then
    return;
  end if;
  if m = 'POST' and p in ('/commitments', '/issues', '/success_measure_entries', '/aimee_handoffs') then
    return;
  end if;
  if m in ('GET', 'POST') and p = '/rpc/assistant_meeting_summaries' then
    return;
  end if;
  raise exception 'assistant_not_on_menu: % %', m, p
    using errcode = '42501',
          hint = 'An outside assistant may only use the AiMS menu.';
end;
$$;

notify pgrst, 'reload config';
