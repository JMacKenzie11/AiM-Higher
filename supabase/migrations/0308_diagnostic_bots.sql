-- =============================================================
-- Migration 0308: the bots behind a Capacity Diagnostic client's
-- automations, and the runs they report
--
-- WHY. Jason, 2026-10-29: most automations are built as Grok Bots.
-- Each bot reports every run to AiMS HQ through the MCP server, signed
-- in as a system admin, and names itself by its bot code (for example
-- northline-invoice-match), which identifies the bot and so the client.
-- A run worked or failed; a failed run counts but saves nothing, and
-- its reason is for system admins only. Savings are items handled
-- times the agreed minutes per item times the agreed hourly rate, in
-- the client's currency. A bot runs on a schedule or when something
-- happens (with an optional "at least once every" safety net); AiMS
-- HQ says when one is Late, Stopped or Needs attention, and tells
-- Jason's Bot Management Grok Bot by webhook when that changes.
--
-- WHAT IT ADDS.
--   diagnostic_automations  unique (id, client_id), so a bot's client
--                           is held to its automation's
--   diagnostic_bots         one bot per automation: its code, how it
--                           starts, the agreed savings, and the last
--                           alert sent (alert_status, written only by
--                           the alerting code, as the service role)
--   diagnostic_bot_runs     one reported run: when, worked or failed,
--                           items handled, a note (admins only)
--   assistant_record_bot_run()  the one write an outside assistant
--                           may make here: a run, for a system admin
--                           on the primary instance, by bot code
--   assistant_bots()        every bot with its last runs, for the same
--                           caller, for the list tools
--   assistant_request_gate()  learns the two functions, and admits
--                           only the roles AI apps are open to
--                           (lib/mcp/switch.ts), not every role but
--                           portfolio_admin: diagnostic_client (0307)
--                           was let through the gate, though nothing
--                           else let it connect
--
-- ACCESS. Both tables: system admin only, for every verb granted;
-- 0295's primary-instance rule; stamp_created_by; refused to outside
-- assistants from birth (0270), so an assistant reaches them only
-- through the two functions. The client's own view of its bots comes
-- with the client dashboard, in a later migration.
--
-- Harness probes "diagnostics · system admin only" (extended) and
-- "diagnostic bots · runs through the assistant".
-- =============================================================

alter table public.diagnostic_automations
  drop constraint if exists diagnostic_automations_id_client_unique;
alter table public.diagnostic_automations
  add constraint diagnostic_automations_id_client_unique unique (id, client_id);

-- ---- Bots ----------------------------------------------------------

create table if not exists public.diagnostic_bots (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null unique,
  client_id uuid not null references public.diagnostic_clients(id) on delete restrict,
  -- Names the bot and so its client. Lower case words and digits
  -- joined by hyphens.
  code text not null unique check (code ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(code) between 3 and 60),
  kind text not null default 'scheduled' check (kind in ('scheduled', 'triggered')),
  -- A scheduled bot: how often, and when (shown, not checked).
  every text check (every is null or every in ('hours', 'day', 'weekday', 'week', 'month')),
  every_hours smallint check (every_hours is null or every_hours between 1 and 24),
  at_time text check (at_time is null or at_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  -- A triggered bot: what sets it off (the client reads this), and the
  -- optional safety net.
  trigger_text text check (trigger_text is null or length(trigger_text) <= 300),
  safety_every text check (safety_every is null or safety_every in ('day', 'weekday', 'week')),
  item_noun text not null default 'item' check (length(btrim(item_noun)) between 1 and 60),
  minutes_per_item numeric(7, 2) not null default 0 check (minutes_per_item >= 0 and minutes_per_item <= 10000),
  hourly_rate numeric(9, 2) not null default 0 check (hourly_rate >= 0 and hourly_rate <= 100000),
  currency text not null default 'CAD' check (currency in ('CAD', 'USD')),
  agreed_on date,
  -- The last status the webhook was told about, and when. Written only
  -- by lib/diagnostics/bot-alerts.ts, as the service role.
  alert_status text check (alert_status is null or alert_status in ('running_well', 'late', 'stopped', 'needs_attention', 'not_live')),
  alert_status_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (kind <> 'scheduled' or every is not null),
  check ((every = 'hours') = (every_hours is not null)),
  foreign key (automation_id, client_id)
    references public.diagnostic_automations (id, client_id) on delete restrict
);

create index if not exists diagnostic_bots_client on public.diagnostic_bots (client_id);

comment on table public.diagnostic_bots is
  'Capacity Diagnostic (0308): the bot behind one automation, its code, schedule or trigger, and agreed savings. System admins only.';

-- ---- Runs ----------------------------------------------------------

create table if not exists public.diagnostic_bot_runs (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references public.diagnostic_bots(id) on delete cascade,
  ran_at timestamptz not null default now(),
  result text not null check (result in ('worked', 'failed')),
  -- Items handled. A failed run saves nothing, whatever it says.
  items integer not null default 1 check (items >= 0 and items <= 1000000),
  -- Why it failed, for system admins. Never shown to the client.
  note text check (note is null or length(note) <= 500),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists diagnostic_bot_runs_bot_ran on public.diagnostic_bot_runs (bot_id, ran_at desc);

comment on table public.diagnostic_bot_runs is
  'Capacity Diagnostic (0308): one run a bot reported. A failed run saves nothing; its note is for system admins. System admins only.';

-- ---- Grants, row security, authorship ------------------------------

do $$
declare t text;
begin
  foreach t in array array['diagnostic_bots', 'diagnostic_bot_runs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop trigger if exists stamp_created_by on public.%I', t);
    execute format(
      'create trigger stamp_created_by before insert on public.%I for each row execute function public.stamp_created_by()',
      t
    );
    -- Roles: system_admin only, for every verb granted.
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select public.auth_role()) = ''system_admin'')',
      t || '_select', t
    );
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select public.auth_role()) = ''system_admin'')',
      t || '_insert', t
    );
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select public.auth_role()) = ''system_admin'') with check ((select public.auth_role()) = ''system_admin'')',
      t || '_update', t
    );
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using ((select public.auth_role()) = ''system_admin'')',
      t || '_delete', t
    );
    -- Roles: none added. Narrows every role's rules to the primary
    -- instance (0295).
    execute format('drop policy if exists %I on public.%I', t || '_primary_only', t);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated '
      'using ((select public.is_primary_instance())) '
      'with check ((select public.is_primary_instance()))',
      t || '_primary_only', t
    );
  end loop;
end $$;

-- ---- What an outside assistant may do here -------------------------

-- Roles: system_admin only, on the primary instance. Writes one run.
-- SECURITY DEFINER because an assistant's token is refused the table
-- itself (0270); this is the one door, and it checks the caller first.
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
  b record;
  run_id uuid;
  n integer;
begin
  if coalesce((select public.auth_role()), '') <> 'system_admin' or not public.is_primary_instance() then
    raise exception 'bot_run_not_allowed' using errcode = '42501',
      hint = 'Only a system admin on AiMS HQ can report a bot run.';
  end if;
  if p_result is null or p_result not in ('worked', 'failed') then
    raise exception 'bot_run_result: % is not worked or failed', p_result using errcode = '22023';
  end if;
  if p_items is not null and (p_items < 0 or p_items > 1000000) then
    raise exception 'bot_run_items: % is out of range', p_items using errcode = '22023';
  end if;
  select bt.id, bt.code, a.title, c.name as client
    into b
    from public.diagnostic_bots bt
    join public.diagnostic_automations a on a.id = bt.automation_id
    join public.diagnostic_clients c on c.id = bt.client_id
   where bt.code = lower(btrim(p_code));
  if b.id is null then
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

-- Roles: system_admin only, on the primary instance. Reads every bot,
-- its automation and client, and its last runs (up to 20 each).
create or replace function public.assistant_bots()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if coalesce((select public.auth_role()), '') <> 'system_admin' or not public.is_primary_instance() then
    raise exception 'bots_not_allowed' using errcode = '42501',
      hint = 'Only a system admin on AiMS HQ can list bots.';
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
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.assistant_bots() from public, anon;
grant execute on function public.assistant_bots() to authenticated;

-- Roles: none. Admits nothing; refuses an assistant off the menu, whose
-- session has ended (0272), that is not approved (0280), whose person's
-- role AI apps are not open to, or that did not come through /api/mcp
-- (0275). Two functions join the menu: a bot's run and the bot list
-- (0308). The role rule is now the allow list lib/mcp/switch.ts keeps
-- (OPEN_ROLES), where it was "every role but portfolio_admin" (0284).
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
  if coalesce((select public.auth_role()), '') not in ('system_admin', 'company_admin', 'aims_guide', 'team_member') then
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
