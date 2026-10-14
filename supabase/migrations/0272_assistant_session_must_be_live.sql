-- 0272: an outside assistant's token stops working the moment the
-- person revokes it.
--
-- WHY. Revoking an assistant (supabase.auth.oauth.revokeGrant) deletes
-- its sessions and refresh tokens, but an access token is a signed JWT
-- that stays valid until it expires, up to an hour. Measured on dev,
-- 2026-10-13: after the person revoked an assistant, its refresh failed
-- and the MCP route refused it (that check asks the Auth server), yet
-- the same token still read the menu straight from the database API.
-- Jason, 2026-10-13: add the session check to the gate, with a probe.
--
-- WHAT. assistant_request_gate (0270) also refuses an assistant whose
-- session no longer exists, or belongs to someone else, or to another
-- assistant, or has passed its not_after. The answer is HTTP 401
-- (PT401), which tells a client to sign in again rather than that it
-- asked for something off the menu. The token carries session_id; the
-- check reads auth.sessions through a SECURITY DEFINER function,
-- because the request's own role cannot read that table.
--
-- Ordinary sign-ins are untouched: the gate returns before this for any
-- token without a client_id. The check covers the database API
-- (PostgREST, and GraphQL through it); Realtime and Storage do not run
-- the gate, and neither serves an assistant anything (0270).

-- Roles: none. A read of the caller's own session row, answering yes
-- or no; it writes nothing.
create or replace function public.assistant_session_live()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with c as (
    select nullif(current_setting('request.jwt.claims', true), '')::jsonb as claims
  )
  select exists (
    select 1
      from auth.sessions s, c
     where s.id::text = c.claims ->> 'session_id'
       and s.user_id = auth.uid()
       and s.oauth_client_id::text = c.claims ->> 'client_id'
       and (s.not_after is null or s.not_after > now())
  )
$$;

comment on function public.assistant_session_live() is
  'True when the request''s assistant token still has its session: not revoked, not expired, the caller''s, this client''s (0272).';

revoke all on function public.assistant_session_live() from public;
grant execute on function public.assistant_session_live() to anon, authenticated, service_role;

-- Roles: none. Admits nothing; refuses an assistant off the menu, and
-- now an assistant whose session has ended.
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

notify pgrst, 'reload config';
