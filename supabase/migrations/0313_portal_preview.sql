-- =============================================================
-- Migration 0313: a system admin previews a client's dashboard
--
-- WHY. Jason, 2026-10-31: a system admin wants to see a Capacity
-- Diagnostic client's portal as that client sees it. Until now the
-- portal answered only the client's own logins, through
-- portal_dashboard(), which reads the caller's client from
-- diagnostic_client_id().
--
-- WHAT IT CHANGES.
--   portal_dashboard_of(cid): the body of portal_dashboard() as 0311
--     left it, for any one client. Internal: nobody signed in can call
--     it directly.
--   portal_dashboard(): now portal_dashboard_of(diagnostic_client_id()).
--     The same answer as before, for the same callers.
--   portal_preview_dashboard(p_client): portal_dashboard_of(p_client)
--     for a system admin on the primary instance; null for anyone else.
--     So the preview shows exactly what the client sees, from the one
--     body, and cannot drift from it.
-- No table changes. A system admin already reads every diagnostic
-- table (0294 onward); this adds nothing they could not read, only
-- the client's view of it.
--
-- ACCESS. Roles: portal_dashboard() diagnostic_client (its own
-- client), as 0310 and 0311. portal_preview_dashboard() system_admin,
-- on the primary instance only. Harness probe "portal preview · system
-- admins only".
-- =============================================================

-- Internal: the dashboard for one client. Called only by the two
-- functions below, which decide whose it is.
create or replace function public.portal_dashboard_of(cid uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
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
    ),
    'diagnostic', (
      select jsonb_build_object('status', d.status, 'kickoff_at', d.kickoff_at, 'readout_at', d.readout_at, 'published_at', d.published_at)
        from public.diagnostics d
       where d.client_id = cid and d.archived_at is null
       order by d.created_at desc
       limit 1
    )
  );
end;
$$;

revoke all on function public.portal_dashboard_of(uuid) from public, anon, authenticated;

-- Roles: diagnostic_client, its own client; nobody else gets anything.
create or replace function public.portal_dashboard()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.portal_dashboard_of(public.diagnostic_client_id())
$$;

revoke all on function public.portal_dashboard() from public, anon;
grant execute on function public.portal_dashboard() to authenticated;

-- Roles: system_admin, on the primary instance; null for anyone else.
create or replace function public.portal_preview_dashboard(p_client uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when (select public.auth_role()) = 'system_admin' and public.is_primary_instance()
      then public.portal_dashboard_of(p_client)
  end
$$;

revoke all on function public.portal_preview_dashboard(uuid) from public, anon;
grant execute on function public.portal_preview_dashboard(uuid) to authenticated;
