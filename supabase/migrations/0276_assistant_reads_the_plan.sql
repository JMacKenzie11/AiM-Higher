-- 0276: an outside assistant reads the company's plan.
--
-- WHY. Jason, 2026-10-14: read tools for quarterly priorities and annual
-- goals (with owner and status), and for the company's core values and
-- plan, whatever AiMS holds today. Read only, like the rest of Phase 2.
--
-- WHAT. Six tables join the read menu: quarters, strategic_focus_areas,
-- annual_goals, priorities, company_foundation (purpose and vision) and
-- foundation_items (core values; the MCP code reads kind = 'core_value'
-- only). Each drops assistant_refused (0270) and takes what every other
-- menu table carries: reads through the table's own rules, as the
-- person; no insert, update or delete for an assistant; and only
-- through /api/mcp (assistant_through_route, 0275). The gate learns
-- their GET paths.
--
-- Nothing else moves. No add, no other function, no other table. Not
-- the meeting schedule: AiMS records none.

do $$
declare
  t text;
begin
  foreach t in array array[
    'quarters', 'strategic_focus_areas', 'annual_goals', 'priorities',
    'company_foundation', 'foundation_items'
  ]
  loop
    execute format('drop policy if exists assistant_refused on public.%I', t);
    -- Roles: none. Restrictive: each takes away from an assistant, and
    -- admits nobody.
    execute format('drop policy if exists assistant_no_insert on public.%I', t);
    execute format(
      'create policy assistant_no_insert on public.%I as restrictive for insert to authenticated '
      'with check (not (select public.is_assistant()))', t);
    execute format('drop policy if exists assistant_no_update on public.%I', t);
    execute format(
      'create policy assistant_no_update on public.%I as restrictive for update to authenticated '
      'using (not (select public.is_assistant())) with check (not (select public.is_assistant()))', t);
    execute format('drop policy if exists assistant_no_delete on public.%I', t);
    execute format(
      'create policy assistant_no_delete on public.%I as restrictive for delete to authenticated '
      'using (not (select public.is_assistant()))', t);
    execute format('drop policy if exists assistant_through_route on public.%I', t);
    execute format(
      'create policy assistant_through_route on public.%I as restrictive for all to authenticated '
      'using (not (select public.is_assistant()) or (select public.assistant_through_route())) '
      'with check (not (select public.is_assistant()) or (select public.assistant_through_route()))', t);
  end loop;
end $$;

-- Roles: none. Admits nothing; refuses an assistant off the menu, whose
-- session has ended (0272), or that did not come through /api/mcp
-- (0275). The menu's reads now include the plan.
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
