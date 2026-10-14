-- 0275: an outside assistant's token reaches the database only through
-- AiMS's own MCP server.
--
-- WHY. Jason, 2026-10-14 (Phase 2b): every assistant call must be
-- logged and rate limited (assistant_actions, 0273), and that happens in
-- /api/mcp. An assistant's token is an ordinary signed-in token, so
-- until now whoever held it could skip the route and read the menu
-- straight from the database API, unlogged and unlimited. This must be
-- in place before Phase 3 (adds) and before any rollout beyond system
-- admins.
--
-- HOW. A per-instance ROUTE KEY that only the AiMS server knows. The MCP
-- route derives it from the instance's service key (lib/mcp/auth.ts) and
-- sends it as the header x-aims-route-key on every database request it
-- makes for an assistant. The assistant never sees it. The database
-- holds only its SHA-256, in aims_private.mcp_route_key, which no API
-- role can read; `npm run mcp:route-key` writes it per instance. Until
-- it is written, no assistant gets anything: the check fails closed.
--
-- Two places check it, each enough for what it covers:
--   1. The gate (assistant_request_gate, PostgREST's pre-request hook)
--      refuses an assistant without the key before the request runs:
--      every path, read or write.
--   2. A restrictive rule on every menu table (assistant_through_route)
--      refuses the same, row by row. This is what covers what the gate
--      does not run for: Realtime's table changes, which read as the
--      token's role and set no request headers. Every other table
--      already refuses an assistant outright (assistant_refused, 0270).
--
-- ORDINARY SIGN-INS ARE UNTOUCHED: both test is_assistant() first.

-- ---- 1. Where the key's hash lives ---------------------------------------

create schema if not exists aims_private;
revoke all on schema aims_private from public, anon, authenticated;

-- One row per instance database. Never the key: its SHA-256, hex.
create table if not exists aims_private.mcp_route_key (
  id boolean primary key default true check (id),
  key_sha256 text not null check (key_sha256 ~ '^[0-9a-f]{64}$'),
  set_at timestamptz not null default now()
);
revoke all on aims_private.mcp_route_key from public, anon, authenticated;

comment on table aims_private.mcp_route_key is
  'SHA-256 of this instance''s MCP route key (0275). Written by npm run mcp:route-key; read only by assistant_through_route().';

-- ---- 2. Did this request come through the route? -------------------------

-- Roles: none. A yes/no about the caller's own request headers; reads
-- the hash it compares against and writes nothing. SECURITY DEFINER only
-- so the caller's role need not reach aims_private.
create or replace function public.assistant_through_route()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with h as (
    select coalesce(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-aims-route-key', '') as k
  )
  select exists (
    select 1
      from aims_private.mcp_route_key r, h
     where h.k <> ''
       and r.key_sha256 = encode(sha256(convert_to(h.k, 'UTF8')), 'hex')
  )
$$;

comment on function public.assistant_through_route() is
  'True when the request carries this instance''s MCP route key (x-aims-route-key): it came through /api/mcp (0275).';

revoke all on function public.assistant_through_route() from public;
grant execute on function public.assistant_through_route() to anon, authenticated, service_role;

-- ---- 3. The gate refuses an assistant that came around the route ---------

-- Roles: none. Admits nothing; refuses an assistant off the menu, whose
-- session has ended (0272), or that did not come through /api/mcp.
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
       '/companies', '/profiles', '/guide_assignments', '/portfolio_assignments') then
    return;
  end if;
  if m = 'POST' and p in ('/commitments', '/issues', '/success_measure_entries') then
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

-- ---- 4. And so does every menu table, row by row --------------------------

-- Roles: none. Restrictive: takes away, admits nothing. On every table
-- an assistant may read or add to, and the two meeting tables the
-- summary function reads.
do $$
declare
  t text;
begin
  foreach t in array array[
    'commitments', 'commitment_occurrences', 'issues',
    'success_measures', 'success_measure_entries', 'success_measure_targets',
    'functions', 'function_roles', 'function_decision_rights', 'function_competencies',
    'companies', 'profiles', 'guide_assignments', 'portfolio_assignments',
    'meetings', 'meeting_analyses'
  ]
  loop
    execute format('drop policy if exists assistant_through_route on public.%I', t);
    execute format(
      'create policy assistant_through_route on public.%I as restrictive for all to authenticated '
      'using (not (select public.is_assistant()) or (select public.assistant_through_route())) '
      'with check (not (select public.is_assistant()) or (select public.assistant_through_route()))',
      t);
  end loop;
end $$;

notify pgrst, 'reload config';
