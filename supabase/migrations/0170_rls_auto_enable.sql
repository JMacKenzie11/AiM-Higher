-- =============================================================
-- Migration 0170: RLS is enabled automatically on new tables
--
-- WHERE THIS CAME FROM. This function and event trigger already
-- existed on production and in no migration file. They were applied
-- by hand, almost certainly following a Supabase security-advisor
-- recommendation, and were found by diffing production against a
-- freshly provisioned instance while adopting production into
-- migration tracking.
--
-- That is the argument for adding it here rather than documenting it
-- as a production-only artifact: every other instance was missing a
-- protection production had. A new customer's database is the one
-- that most needs a backstop against a table shipped without RLS,
-- and it was the one least likely to have it.
--
-- WHAT IT DOES. After any CREATE TABLE in the public schema, it
-- enables row level security on the new table. It is a backstop, not
-- a substitute: a table with RLS on and no policy is readable by
-- nobody except service_role, so a migration that forgets its
-- policies still fails loudly rather than leaking. What this prevents
-- is the worse case — a table that forgets `enable row level
-- security` entirely and is therefore readable by every authenticated
-- user.
--
-- It swallows its own failures by design. An event trigger that
-- raises takes the CREATE TABLE down with it, which would turn a
-- safety net into an outage; it logs instead.
--
-- SECURITY DEFINER with a pinned search_path, because it has to alter
-- a table the creating role may not own, and a mutable search_path on
-- a definer function is its own vulnerability.
-- =============================================================

create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  cmd record;
begin
  for cmd in
    select *
    from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table', 'partitioned table')
  loop
    if cmd.schema_name is not null
       and cmd.schema_name in ('public')
       and cmd.schema_name not in ('pg_catalog', 'information_schema')
       and cmd.schema_name not like 'pg_toast%'
       and cmd.schema_name not like 'pg_temp%' then
      begin
        execute format('alter table if exists %s enable row level security', cmd.object_identity);
        raise log 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      exception
        when others then
          raise log 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      end;
    else
      raise log 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)',
        cmd.object_identity, cmd.schema_name;
    end if;
  end loop;
end;
$function$;

-- Recreated rather than guarded with "if not exists", which event
-- triggers do not support. Dropping first makes this rerunnable and
-- makes production converge on exactly this definition rather than
-- keeping whatever was applied by hand.
drop event trigger if exists ensure_rls;

create event trigger ensure_rls
  on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  execute function public.rls_auto_enable();
