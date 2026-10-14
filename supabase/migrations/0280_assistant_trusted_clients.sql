-- 0280: only approved assistants, by where they send the person back.
--
-- WHY. Jason, 2026-10-14: clients connect by pasting only the server
-- address, the way every other MCP connector works, so dynamic client
-- registration is on and anyone can register a client. What makes a
-- client trustworthy is where Supabase sends the authorization code: a
-- code delivered to https://claude.ai/... can only be used by Claude,
-- whatever name the client gave itself. So the gate is an allow-list of
-- redirect addresses, kept here, and a client is approved only if EVERY
-- address it registered is on it.
--
-- THREE PLACES ASK, so no path around one gets anywhere:
--   1. The consent page (/oauth/consent) shows Allow only for an
--      approved client, and its approve action asks again on the server
--      (assistant_client_trusted, via the service role).
--   2. Token issuance. mcp_access_token_hook is Supabase Auth's custom
--      access token hook: it runs every time a token is issued or
--      refreshed, and refuses one for an unapproved client. A person who
--      approves through Supabase's own API, skipping our page, gets no
--      token. Ordinary sign-ins carry no client_id and pass untouched.
--   3. The database gate (assistant_request_gate) refuses an unapproved
--      client's token anyway, in case one exists from before.
--
-- THE LIST. Exact addresses, or an exact prefix with a safe identifier,
-- https only. Not hosts alone: a host rule would let
-- https://claude.ai.evil.example through a careless suffix match, and
-- would accept any path on the host.
--   https://claude.ai/api/mcp/auth_callback
--   https://claude.com/api/mcp/auth_callback      (Anthropic: may move here)
--   https://chatgpt.com/connector_platform_oauth_redirect
--   https://chatgpt.com/connector/oauth/<id>      (ChatGPT's per-connector form)
-- Not localhost (Claude Code): see the report of 2026-10-14.
-- src/lib/mcp/trusted-clients.ts mirrors this list for display only;
-- trusted-clients.test.ts fails if the two disagree.

-- Roles: none. A pure test of one address.
create or replace function public.mcp_redirect_trusted(uri text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(uri, '') in (
           'https://claude.ai/api/mcp/auth_callback',
           'https://claude.com/api/mcp/auth_callback',
           'https://chatgpt.com/connector_platform_oauth_redirect')
      or coalesce(uri, '') ~ '^https://chatgpt\.com/connector/oauth/[A-Za-z0-9_-]{1,128}$'
$$;

comment on function public.mcp_redirect_trusted(text) is
  'True when one redirect address is on the outside-assistant allow-list (0280).';

-- Roles: none. Reads one client's registration; writes nothing. SECURITY
-- DEFINER because auth.oauth_clients is not readable by request roles.
create or replace function public.assistant_client_trusted(p_client_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select count(*) > 0 and bool_and(public.mcp_redirect_trusted(btrim(u)))
      from auth.oauth_clients c,
           unnest(string_to_array(c.redirect_uris, ',')) as u
     where c.id::text = p_client_id
       and c.deleted_at is null
  ), false)
$$;

comment on function public.assistant_client_trusted(text) is
  'True when the OAuth client exists and every redirect address it registered is on the allow-list (0280).';

revoke all on function public.assistant_client_trusted(text) from public;
grant execute on function public.assistant_client_trusted(text) to anon, authenticated, service_role, supabase_auth_admin;
revoke all on function public.mcp_redirect_trusted(text) from public;
grant execute on function public.mcp_redirect_trusted(text) to anon, authenticated, service_role, supabase_auth_admin;

-- Roles: none. Supabase Auth's custom access token hook. Returns the
-- event unchanged for anything without a client_id (every ordinary
-- sign-in), and an error for an unapproved assistant client, which
-- makes Auth refuse to issue or refresh the token.
create or replace function public.mcp_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  cid text := nullif(event -> 'claims' ->> 'client_id', '');
begin
  if cid is null or public.assistant_client_trusted(cid) then
    return event;
  end if;
  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'This assistant isn''t approved for AiMS.'));
end;
$$;

comment on function public.mcp_access_token_hook(jsonb) is
  'Custom access token hook: refuses a token for an outside assistant whose redirect addresses are not on the allow-list (0280).';

revoke all on function public.mcp_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function public.mcp_access_token_hook(jsonb) to supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;

-- Roles: none. Admits nothing; refuses an assistant off the menu, whose
-- session has ended (0272), that did not come through /api/mcp (0275),
-- or whose client is not approved (0280).
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

notify pgrst, 'reload config';
