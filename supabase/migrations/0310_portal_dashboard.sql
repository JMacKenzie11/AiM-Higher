-- =============================================================
-- Migration 0310: the client dashboard's reads
--
-- WHY. Jason, 2026-10-29 (the approved client portal mockup): a
-- diagnostic client's people see their bots (status, runs, hours and
-- money saved, the schedule), the automations being built, and their
-- published Capacity Diagnostic readout. A failed run's reason is for
-- system admins only, and so is a bot's code.
--
-- WHAT IT ADDS. Two functions, read only, SECURITY DEFINER, for the
-- caller's own client (diagnostic_client_id(), 0307: an active
-- diagnostic_client on the primary instance) and for nobody else:
--   portal_dashboard()  the client's bots, each with its automation,
--                       how it starts, the agreed savings, its runs
--                       from the last nine weeks and its last twenty
--                       (when, worked or failed, items; never the
--                       note), and its total items and runs; and the
--                       newest published readout's date
--   portal_readout()    that published readout, as published
--
-- No table is opened. The bots and runs tables stay system admin only
-- (0308); these return the columns a client may see and nothing else,
-- built here so a later column cannot leak through a `select *`.
--
-- ACCESS. Roles: diagnostic_client (its own client), through the two
-- functions only. Outside assistants are refused both by the gate
-- (not on the menu, 0270/0308). Harness probe "diagnostic client · own
-- client only", extended.
-- =============================================================

-- Roles: diagnostic_client, its own client; nobody else gets anything.
create or replace function public.portal_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  cid uuid := public.diagnostic_client_id();
begin
  if cid is null then
    return null;
  end if;
  return jsonb_build_object(
    'bots', coalesce((
      select jsonb_agg(jsonb_build_object(
        'automation', jsonb_build_object('id', a.id, 'title', a.title, 'stage', a.stage, 'goes_live', a.goes_live),
        'bot', jsonb_build_object(
          'kind', bt.kind, 'every', bt.every, 'every_hours', bt.every_hours, 'at_time', bt.at_time,
          'trigger_text', bt.trigger_text, 'safety_every', bt.safety_every, 'item_noun', bt.item_noun,
          'minutes_per_item', bt.minutes_per_item, 'hourly_rate', bt.hourly_rate, 'currency', bt.currency,
          'agreed_on', bt.agreed_on, 'created_at', bt.created_at
        ),
        'runs', coalesce((
          select jsonb_agg(jsonb_build_object('ran_at', r.ran_at, 'result', r.result, 'items', r.items) order by r.ran_at desc)
            from (
              select r.ran_at, r.result, r.items
                from public.diagnostic_bot_runs r
               where r.bot_id = bt.id
                 and (r.ran_at > now() - interval '63 days'
                      or r.id in (select r2.id from public.diagnostic_bot_runs r2 where r2.bot_id = bt.id order by r2.ran_at desc limit 20))
               order by r.ran_at desc
               limit 3000
            ) r
        ), '[]'::jsonb),
        'total_items_worked', (select coalesce(sum(r.items), 0) from public.diagnostic_bot_runs r where r.bot_id = bt.id and r.result = 'worked'),
        'total_runs', (select count(*) from public.diagnostic_bot_runs r where r.bot_id = bt.id),
        'first_run_at', (select min(r.ran_at) from public.diagnostic_bot_runs r where r.bot_id = bt.id)
      ) order by a.title)
        from public.diagnostic_bots bt
        join public.diagnostic_automations a on a.id = bt.automation_id
       where bt.client_id = cid
    ), '[]'::jsonb),
    'readout_published_at', (
      select max(d.published_at) from public.diagnostics d
       where d.client_id = cid and d.published_at is not null and d.archived_at is null
    )
  );
end;
$$;

revoke all on function public.portal_dashboard() from public, anon;
grant execute on function public.portal_dashboard() to authenticated;

-- Roles: diagnostic_client, its own client's newest published readout.
create or replace function public.portal_readout()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select d.published_readout
    from public.diagnostics d
   where d.client_id = public.diagnostic_client_id()
     and d.published_at is not null
     and d.archived_at is null
   order by d.published_at desc
   limit 1
$$;

revoke all on function public.portal_readout() from public, anon;
grant execute on function public.portal_readout() to authenticated;
