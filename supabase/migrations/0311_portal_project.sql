-- =============================================================
-- Migration 0311: the client dashboard shows where the project stands
--
-- WHY. Jason, 2026-10-30 (approved portal mockup, "Your project"): a
-- client with no bot yet sees the four stages of their project
-- (Capacity Diagnostic, readout, building, running), with the
-- kickoff and readout dates, before anything goes live.
--
-- WHAT IT CHANGES. portal_dashboard() (0310) also returns
-- 'diagnostic': the client's newest diagnostic that is not archived,
-- as its status, kickoff date, readout date and when it was published.
-- Nothing else from the diagnostic: no notes, scores or answers.
-- Everything else the function returns is as 0310 left it.
--
-- ACCESS. Roles: diagnostic_client (its own client), through the
-- function only, as 0310. No table is opened. Harness probe
-- "diagnostic client · own client only", extended.
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

revoke all on function public.portal_dashboard() from public, anon;
grant execute on function public.portal_dashboard() to authenticated;
