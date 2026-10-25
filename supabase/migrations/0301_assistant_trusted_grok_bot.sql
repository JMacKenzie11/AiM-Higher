-- 0301: Grok Bot joins the approved assistants.
--
-- WHY. Jason, 2026-10-25: people want to connect AiMS to Grok Bot the
-- way they connect Claude and ChatGPT. Grok Bot connects to a remote
-- MCP server by its address and signs in with OAuth and dynamic client
-- registration, so it reaches /api/mcp with nothing new on our side
-- except this list.
--
-- WHAT IT REGISTERS. One registration carries every return address
-- Grok Bot and Cursor (the code editor, which shares it) may use, and
-- 0280 approves a client only if EVERY address it registered is on
-- the list. So all six go on, exactly, or Grok Bot is refused:
--   https://grok.com/connectors-oauth-exchange-code/
--   https://www.cursor.com/bot/mcp/oauth/callback
--   https://www.cursor.com/agents/mcp/oauth/callback
--   cursor://anysphere.cursor-mcp/oauth/callback
--   http://localhost:8787/callback
--   http://127.0.0.1:8787/callback
-- Sources: Cursor's client metadata document
-- (https://cursor.com/oauth/mcp-client.json, 2026-10-21) and Cursor
-- staff's list of what registration sends (2026-09-16).
--
-- THE TRADE, decided by Jason after the risks were set out. The last
-- three return to a program on the person's own computer, and any
-- program there can listen on that port or claim that scheme. 0280
-- left localhost out for that reason (Claude Code). What it costs: a
-- client registering only these, under any name, is approved, and its
-- code reaches whatever on that computer is listening. That needs the
-- attacker's software already running there and the person to press
-- Allow; nobody off the machine receives anything, and PKCE keeps the
-- code useless in transit. The consent page says so when the return is
-- local (lib/mcp/trusted-clients.ts, returnsToThisComputer). Exact
-- addresses only: port 8787 and these paths, never any localhost.
--
-- Removing an address later cuts its clients off at once: the token
-- hook and the database gate ask this function on every token and
-- every request.
--
-- src/lib/mcp/trusted-clients.ts mirrors the list; trusted-clients.test.ts
-- fails if the two disagree. Harness probe "assistant clients ·
-- approved by where they return" now also registers Grok Bot (granted)
-- and a localhost on another port and a cursor:// lookalike (refused).

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
           'https://chatgpt.com/connector_platform_oauth_redirect',
           'https://grok.com/connectors-oauth-exchange-code/',
           'https://www.cursor.com/bot/mcp/oauth/callback',
           'https://www.cursor.com/agents/mcp/oauth/callback',
           'cursor://anysphere.cursor-mcp/oauth/callback',
           'http://localhost:8787/callback',
           'http://127.0.0.1:8787/callback')
      or coalesce(uri, '') ~ '^https://chatgpt\.com/connector/oauth/[A-Za-z0-9_-]{1,128}$'
$$;

comment on function public.mcp_redirect_trusted(text) is
  'True when one redirect address is on the outside-assistant allow-list (0280, Grok Bot 0301).';

revoke all on function public.mcp_redirect_trusted(text) from public;
grant execute on function public.mcp_redirect_trusted(text) to anon, authenticated, service_role, supabase_auth_admin;
