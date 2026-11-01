-- =============================================================
-- Migration 0314: automation accounts for the bots
--
-- WHY. Jason, 2026-11-01: a client's Grok Bots sign in to AiMS HQ
-- through the connector to report their runs. Signed in as a system
-- admin they reached every tool the connector has: every company's
-- plan, commitments, measures, issues and meeting summaries, and adds
-- to them. Each client now gets an automation account (a Gmail the
-- client creates, shared for Grok) that reaches that client's bots and
-- nothing else, and Jason's Bot Management bot gets one that lists
-- every client's bots and does nothing else.
--
-- WHAT IT ADDS.
--   profiles                 the role bot_account: a real role
--                            (profiles_role_check), company-less and
--                            never with a company, as diagnostic_client
--                            (0307) and for the same reason.
--   diagnostic_bot_accounts  one row per automation account: its scope,
--                            'client' (one client's bots: report runs
--                            and list them) or 'all' (list every
--                            client's bots; report nothing).
--   bot_account_scope()      the caller's scope, or null for anyone who
--   bot_account_client()     is not an active bot_account on HQ; and
--                            its client, for a 'client' account.
--
-- WHAT IT CHANGES.
--   assistant_record_bot_run() also admits a 'client' automation
--     account, for its own client's bots. Another client's bot code
--     answers as unknown (P0002), so it cannot even learn it exists.
--   assistant_bots() also admits an automation account: a 'client'
--     account sees its client's bots, an 'all' account every client's.
--   assistant_request_gate() opens AI apps to bot_account, with a menu
--     of its own: its profile row, and those two functions. Nothing on
--     the rest of the menu.
--   A system admin keeps both, as before.
--
-- ACCESS. Roles: bot_account, through the two functions only. Its own
-- profile row (the policies already there) and its own account row
-- are all it reads, and through an assistant's token not even the
-- account row, which 0270 closes to assistants as every new table. Every
-- other policy in the schema names the roles it admits and the role
-- has no company, so it reaches nothing else. The app agrees: the
-- connector shows it only the three bot tools, and every page but
-- sign-in and the consent screen sends it to /automation-account.
-- Harness probe "automation accounts · their own bots only".
-- =============================================================

-- ---- The role ----------------------------------------------------

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('system_admin', 'company_admin', 'team_member',
                  'aims_guide', 'portfolio_admin', 'diagnostic_client', 'bot_account'));

alter table public.profiles
  drop constraint if exists profiles_role_requires_company;
alter table public.profiles add constraint profiles_role_requires_company
  check (
    role in ('system_admin', 'aims_guide', 'portfolio_admin', 'diagnostic_client', 'bot_account')
    or company_id is not null
  );

alter table public.profiles
  drop constraint if exists profiles_bot_account_has_no_company;
alter table public.profiles add constraint profiles_bot_account_has_no_company
  check (role <> 'bot_account' or company_id is null);

-- ---- Automation accounts -------------------------------------------

create table if not exists public.diagnostic_bot_accounts (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  scope text not null check (scope in ('client', 'all')),
  client_id uuid references public.diagnostic_clients(id) on delete restrict,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check ((scope = 'client') = (client_id is not null))
);

create index if not exists diagnostic_bot_accounts_client on public.diagnostic_bot_accounts (client_id);

comment on table public.diagnostic_bot_accounts is
  'Capacity Diagnostic (0314): an automation account and what it reaches, one client''s bots or every client''s bot list. System admins write; the account reads its own row.';

-- Only a bot_account can be one.
create or replace function public.assert_diagnostic_bot_account_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = new.profile_id and role = 'bot_account') then
    raise exception 'diagnostic_bot_account_role: % is not an automation account', new.profile_id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.assert_diagnostic_bot_account_role() from public, anon, authenticated;

drop trigger if exists diagnostic_bot_accounts_role on public.diagnostic_bot_accounts;
create trigger diagnostic_bot_accounts_role
  before insert or update on public.diagnostic_bot_accounts
  for each row execute function public.assert_diagnostic_bot_account_role();

alter table public.diagnostic_bot_accounts enable row level security;
alter table public.diagnostic_bot_accounts force row level security;
revoke all on public.diagnostic_bot_accounts from public, anon, authenticated;
grant select, insert, delete on public.diagnostic_bot_accounts to authenticated;

drop trigger if exists stamp_created_by on public.diagnostic_bot_accounts;
create trigger stamp_created_by before insert on public.diagnostic_bot_accounts
  for each row execute function public.stamp_created_by();

-- Roles: system_admin reads every row; an automation account its own.
drop policy if exists diagnostic_bot_accounts_select on public.diagnostic_bot_accounts;
create policy diagnostic_bot_accounts_select on public.diagnostic_bot_accounts
  for select to authenticated
  using ((select public.auth_role()) = 'system_admin' or profile_id = (select auth.uid()));
-- Roles: system_admin only.
drop policy if exists diagnostic_bot_accounts_insert on public.diagnostic_bot_accounts;
create policy diagnostic_bot_accounts_insert on public.diagnostic_bot_accounts
  for insert to authenticated with check ((select public.auth_role()) = 'system_admin');
-- Roles: system_admin only.
drop policy if exists diagnostic_bot_accounts_delete on public.diagnostic_bot_accounts;
create policy diagnostic_bot_accounts_delete on public.diagnostic_bot_accounts
  for delete to authenticated using ((select public.auth_role()) = 'system_admin');

-- Roles: none added. Narrows every role's rules to the primary instance
-- (0295).
drop policy if exists diagnostic_bot_accounts_primary_only on public.diagnostic_bot_accounts;
create policy diagnostic_bot_accounts_primary_only on public.diagnostic_bot_accounts
  as restrictive for all to authenticated
  using ((select public.is_primary_instance()))
  with check ((select public.is_primary_instance()));

-- ---- The caller's scope -------------------------------------------

-- Roles: any caller; answers only for an active bot_account on HQ.
create or replace function public.bot_account_scope()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select a.scope
  from public.diagnostic_bot_accounts a
  join public.profiles p on p.id = a.profile_id
  where a.profile_id = auth.uid()
    and p.role = 'bot_account'
    and p.status = 'active'
    and public.is_primary_instance()
  limit 1
$$;

revoke all on function public.bot_account_scope() from public, anon;
grant execute on function public.bot_account_scope() to authenticated;

-- Roles: any caller; answers only for an active 'client' bot_account on HQ.
create or replace function public.bot_account_client()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select a.client_id
  from public.diagnostic_bot_accounts a
  join public.profiles p on p.id = a.profile_id
  where a.profile_id = auth.uid()
    and a.scope = 'client'
    and p.role = 'bot_account'
    and p.status = 'active'
    and public.is_primary_instance()
  limit 1
$$;

revoke all on function public.bot_account_client() from public, anon;
grant execute on function public.bot_account_client() to authenticated;

-- ---- The two doors -------------------------------------------------

-- Roles: system_admin (any bot) and a 'client' bot_account (its own
-- client's bots), on the primary instance. Writes one run.
create or replace function public.assistant_record_bot_run(
  p_code text,
  p_result text,
  p_items integer default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  scope_client uuid;
  b record;
  run_id uuid;
  n integer;
begin
  -- A system admin reports for any bot; an automation account for its
  -- own client's bots only (checked below, once the bot is found).
  scope_client := public.bot_account_client();
  if not public.is_primary_instance()
     or (coalesce((select public.auth_role()), '') <> 'system_admin' and scope_client is null) then
    raise exception 'bot_run_not_allowed' using errcode = '42501',
      hint = 'Only a system admin or the client''s automation account can report a bot run.';
  end if;
  if p_result is null or p_result not in ('worked', 'failed') then
    raise exception 'bot_run_result: % is not worked or failed', p_result using errcode = '22023';
  end if;
  if p_items is not null and (p_items < 0 or p_items > 1000000) then
    raise exception 'bot_run_items: % is out of range', p_items using errcode = '22023';
  end if;
  select bt.id, bt.code, bt.client_id, a.title, c.name as client
    into b
    from public.diagnostic_bots bt
    join public.diagnostic_automations a on a.id = bt.automation_id
    join public.diagnostic_clients c on c.id = bt.client_id
   where bt.code = lower(btrim(p_code));
  -- Another client's bot is, to an automation account, no bot at all.
  if b.id is null
     or ((select public.auth_role()) = 'bot_account' and b.client_id is distinct from scope_client) then
    raise exception 'bot_unknown: no bot has the code %', p_code using errcode = 'P0002',
      hint = 'Check the bot code on the automation in AiMS HQ.';
  end if;
  n := case when p_result = 'failed' then 0 else coalesce(p_items, 1) end;
  insert into public.diagnostic_bot_runs (bot_id, result, items, note, created_by)
  values (b.id, p_result, n, nullif(left(btrim(coalesce(p_note, '')), 500), ''), auth.uid())
  returning id into run_id;
  return jsonb_build_object('run_id', run_id, 'bot_id', b.id, 'bot', b.code, 'automation', b.title, 'client', b.client,
    'result', p_result, 'items', n);
end;
$$;

revoke all on function public.assistant_record_bot_run(text, text, integer, text) from public, anon;
grant execute on function public.assistant_record_bot_run(text, text, integer, text) to authenticated;

-- Roles: system_admin and an 'all' bot_account (every bot), a 'client'
-- bot_account (its own client's), on the primary instance.
create or replace function public.assistant_bots()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r text := coalesce((select public.auth_role()), '');
  scope text := public.bot_account_scope();
  scope_client uuid := public.bot_account_client();
begin
  if not public.is_primary_instance() or (r <> 'system_admin' and scope is null) then
    raise exception 'bots_not_allowed' using errcode = '42501',
      hint = 'Only a system admin or an automation account can list bots.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'bot', to_jsonb(bt) - 'created_by',
      'automation', jsonb_build_object('title', a.title, 'stage', a.stage, 'goes_live', a.goes_live),
      'client', c.name,
      'runs', coalesce((
        select jsonb_agg(jsonb_build_object('ran_at', r.ran_at, 'result', r.result, 'items', r.items, 'note', r.note) order by r.ran_at desc)
          from (select * from public.diagnostic_bot_runs r where r.bot_id = bt.id order by r.ran_at desc limit 20) r
      ), '[]'::jsonb)
    ) order by c.name, a.title)
      from public.diagnostic_bots bt
      join public.diagnostic_automations a on a.id = bt.automation_id
      join public.diagnostic_clients c on c.id = bt.client_id
     where c.archived_at is null
       -- A client's automation account: that client's bots only.
       and (r = 'system_admin' or scope = 'all' or bt.client_id = scope_client)
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.assistant_bots() from public, anon;
grant execute on function public.assistant_bots() to authenticated;

-- ---- The gate ------------------------------------------------------

-- Roles: none. Admits nothing; refuses an assistant off the menu, whose
-- session has ended (0272), that is not approved (0280), whose person's
-- role AI apps are not open to, or that did not come through /api/mcp
-- (0275). An automation account (0314) joins the roles, with a menu of
-- its own.
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
  -- The roles AI apps are open to (lib/mcp/switch.ts, OPEN_ROLES).
  if coalesce((select public.auth_role()), '') not in ('system_admin', 'company_admin', 'aims_guide', 'team_member', 'bot_account') then
    raise exception 'assistant_role_not_open'
      using errcode = '42501',
            hint = 'AI apps aren''t open to this account.';
  end if;
  if not public.assistant_through_route() then
    raise exception 'assistant_outside_route'
      using errcode = '42501',
            hint = 'An outside assistant reaches AiMS only through its MCP server.';
  end if;
  m := upper(coalesce(current_setting('request.method', true), ''));
  p := rtrim(coalesce(current_setting('request.path', true), ''), '/');
  -- An automation account (0314) has a menu of its own: its own
  -- profile row (the MCP route checks it is active), a bot's run and
  -- the bot list. Nothing else, whatever the rest of the menu allows.
  if (select public.auth_role()) = 'bot_account' then
    if (m in ('GET', 'HEAD') and p = '/profiles')
       or (m = 'POST' and p = '/rpc/assistant_record_bot_run')
       or (m in ('GET', 'POST') and p = '/rpc/assistant_bots') then
      return;
    end if;
    raise exception 'assistant_not_on_menu: % %', m, p
      using errcode = '42501',
            hint = 'An automation account may only report and list bots.';
  end if;
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
  if m = 'POST' and p = '/rpc/assistant_record_bot_run' then
    return;
  end if;
  if m in ('GET', 'POST') and p = '/rpc/assistant_bots' then
    return;
  end if;
  raise exception 'assistant_not_on_menu: % %', m, p
    using errcode = '42501',
          hint = 'An outside assistant may only use the AiMS menu.';
end;
$$;

notify pgrst, 'reload config';
