-- 0295: The Capacity Diagnostic lives on the primary instance only.
--
-- 0294 runs everywhere, because every migration does: the runner pushes
-- the whole folder to every database. Jason (2026-10-22): the module is
-- for HQ alone. So the tables exist on every instance and open only
-- where public.instance_settings.is_primary is true (0231): HQ, and the
-- dev clone for local work and e2e. That flag is set by
-- `npm run instance:primary` and by nothing in the app, so there is no
-- switch anyone can reach from a page.
--
-- One restrictive rule per table, for every verb. Restrictive rules are
-- ANDed with 0294's permissive ones, so each of those still decides who
-- (system_admin only) and this decides where. On a client instance a
-- system admin reads nothing and writes nothing here.

do $$
declare t text;
begin
  foreach t in array array[
    'diagnostic_clients',
    'diagnostics',
    'diagnostic_participants',
    'diagnostic_tasks',
    'diagnostic_answers',
    'diagnostic_notes',
    'diagnostic_quotes',
    'diagnostic_wins'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_primary_only', t);
    -- Roles: none added. Narrows every role's rules to the primary instance.
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated '
      'using ((select public.is_primary_instance())) '
      'with check ((select public.is_primary_instance()))',
      t || '_primary_only', t
    );
  end loop;
end $$;
