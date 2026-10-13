-- 0270: an outside assistant's token is refused everywhere except the
-- menu.
--
-- WHY. Outside assistants (Claude, ChatGPT and the like) will sign a
-- person in through Supabase's OAuth server and act as that person. The
-- token they receive is an ordinary `authenticated` JWT, plus a
-- `client_id` claim naming the assistant, and it works directly
-- against the database API with the public anon key, not only through
-- our MCP route. So whatever this person could do, the token could do,
-- unless the database itself says otherwise. Jason, 2026-10-13: an
-- allow list, not a block list. Refused on every table and every
-- database function by default; allowed only the menu.
--
-- THE MENU (v1).
--   Read    commitments, commitment_occurrences, issues,
--           success_measures, success_measure_entries,
--           success_measure_targets, functions, function_roles,
--           function_decision_rights, function_competencies, and to
--           make sense of them: companies, profiles, guide_assignments,
--           portfolio_assignments.
--           Meeting summaries, through assistant_meeting_summaries()
--           only: the summary and its commitments, never the
--           transcript, the facilitation review or the scores.
--   Add     a commitment (the caller's own, open, nothing resolved),
--           an issue (open), a weekly measure value (typed, never
--           over an existing one: an assistant has no update).
--   Never   update or delete anything, read anything else, call any
--           other function through the API.
--
-- HOW, three layers, each enough on its own for what it covers.
--
--   1. Rows. A RESTRICTIVE policy on every table in public and storage
--      that refuses a request carrying a client_id, except what the
--      menu allows on that table. Restrictive policies AND with the
--      existing ones, so the person's own access rules still decide
--      everything an assistant may see or add; this only ever takes
--      away. Covers PostgREST, GraphQL, Realtime and Storage alike,
--      because all of them run queries as the token's role with its
--      claims.
--
--   2. Entry points. PostgREST's pre-request hook
--      (assistant_request_gate) refuses an assistant any path and
--      method not on the menu, before the request touches a table.
--      This is what covers every database function: an RPC is a path
--      (/rpc/<name>), so every function in an exposed schema is
--      refused unless named, and so is GraphQL (/rpc/graphql). Every
--      existing function is covered without being edited, and so is
--      every function written after this.
--
--   3. New tables. An event trigger gives every table created in
--      public from now on the refusing policy at birth, the way 0170
--      turns RLS on. The harness check `assistant allow list` fails if
--      any table or function lacks the rule anyway.
--
-- WHAT IT DOES NOT COVER, and what does: the Auth API (/auth/v1, such
-- as changing a password or email) does not go through the database as
-- the token's role, so no rule here reaches it. That is handled, and
-- proved, separately.
--
-- ORDINARY SIGN-INS ARE UNTOUCHED. Every rule and the gate test
-- is_assistant() first; a token without a client_id passes straight
-- through, so the app, Aimee and every existing caller behave exactly
-- as before.

-- ---- 1. Who is an assistant ------------------------------------------

-- A request whose JWT carries a client_id, which Supabase's OAuth server
-- puts on every token it issues and nothing else does. The app's own
-- sign-ins never carry one.
-- Roles: none. A test, not a write rule.
create or replace function public.is_assistant()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'client_id',
    ''
  ) <> ''
$$;

comment on function public.is_assistant() is
  'True when the request''s JWT carries a client_id: a token issued by the OAuth server to an outside assistant (0270).';

grant execute on function public.is_assistant() to anon, authenticated, service_role;

-- ---- 2. Meeting summaries, and nothing else of a meeting --------------

-- The one function on the menu. SECURITY INVOKER: it reads as the
-- caller, so the meetings and meeting_analyses read rules decide which
-- meetings come back, exactly as on the Meeting Summaries page. It
-- opens the assistant's restrictive rule on those two tables by
-- setting aims.assistant_scope for the length of its own read, and
-- closes it again before returning; the select list is all that comes
-- back: never transcript_text, the facilitation review, the scores or
-- spelling changes. (Not a SET clause on the function: Postgres lets
-- only a superuser attach a custom setting that way.) A client cannot
-- set aims.assistant_scope itself: PostgREST runs one statement per
-- request and sets only request.* settings, and the gate below refuses
-- every other function.
-- Roles: read only, as the caller.
create or replace function public.assistant_meeting_summaries(
  p_company_id uuid,
  p_limit integer default 8,
  p_meeting_id uuid default null
)
returns table (
  meeting_id uuid,
  meeting_title text,
  held_at timestamptz,
  summary text,
  commitments jsonb,
  truncated boolean
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  perform set_config('aims.assistant_scope', 'meeting_summaries', true);
  return query
    select m.id, m.meeting_title, m.created_at,
           a.analysis_markdown, a.commitments_json, coalesce(a.truncated, false)
      from public.meetings m
      left join public.meeting_analyses a on a.meeting_id = m.id
     where m.company_id = p_company_id
       and m.status = 'complete'
       and (p_meeting_id is null or m.id = p_meeting_id)
     order by m.created_at desc
     limit least(greatest(coalesce(p_limit, 8), 1), 20);
  perform set_config('aims.assistant_scope', '', true);
exception when others then
  perform set_config('aims.assistant_scope', '', true);
  raise;
end;
$$;

comment on function public.assistant_meeting_summaries(uuid, integer, uuid) is
  'An outside assistant''s only view of meetings: title, date, written summary and its commitments, read as the caller (0270).';

revoke all on function public.assistant_meeting_summaries(uuid, integer, uuid) from public;
grant execute on function public.assistant_meeting_summaries(uuid, integer, uuid) to authenticated;

-- ---- 3. Rows: a restrictive rule on every table -----------------------

do $$
declare
  menu_read constant text[] := array[
    'commitments', 'commitment_occurrences', 'issues',
    'success_measures', 'success_measure_entries', 'success_measure_targets',
    'functions', 'function_roles', 'function_decision_rights', 'function_competencies',
    'companies', 'profiles', 'guide_assignments', 'portfolio_assignments'
  ];
  summary_tables constant text[] := array['meetings', 'meeting_analyses'];
  t record;
begin
  for t in
    select n.nspname as schema_name, c.relname as table_name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r', 'p')
       and n.nspname in ('public', 'storage')
  loop
    if t.schema_name = 'public' and t.table_name = any (menu_read || summary_tables) then
      -- On the menu: reads stay with the table's own rules (or, for
      -- the summary tables, are open only inside the summary
      -- function); writes are refused except the three adds, below.
      if t.table_name = any (summary_tables) then
        execute format(
          'create policy assistant_summaries_only on %I.%I as restrictive for select to authenticated '
          'using (not (select public.is_assistant()) '
          'or current_setting(''aims.assistant_scope'', true) = ''meeting_summaries'')',
          t.schema_name, t.table_name);
      end if;
      if t.table_name not in ('commitments', 'issues', 'success_measure_entries') then
        execute format(
          'create policy assistant_no_insert on %I.%I as restrictive for insert to authenticated '
          'with check (not (select public.is_assistant()))',
          t.schema_name, t.table_name);
      end if;
      execute format(
        'create policy assistant_no_update on %I.%I as restrictive for update to authenticated '
        'using (not (select public.is_assistant())) with check (not (select public.is_assistant()))',
        t.schema_name, t.table_name);
      execute format(
        'create policy assistant_no_delete on %I.%I as restrictive for delete to authenticated '
        'using (not (select public.is_assistant()))',
        t.schema_name, t.table_name);
    else
      begin
        execute format(
          'create policy assistant_refused on %I.%I as restrictive for all to authenticated '
          'using (not (select public.is_assistant())) with check (not (select public.is_assistant()))',
          t.schema_name, t.table_name);
      exception when insufficient_privilege then
        -- Storage owns a few of its own tables (migrations,
        -- buckets_vectors, vector_indexes) and only its role may add a
        -- rule to them. That is safe only while nobody signed in can
        -- reach them at all: row security on and no permissive rule.
        -- If that ever stops being true, this migration fails rather
        -- than leave a gap.
        if t.schema_name <> 'storage'
           or not (select c.relrowsecurity from pg_class c
                     join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = t.schema_name and c.relname = t.table_name)
           or exists (select 1 from pg_policies p
                       where p.schemaname = t.schema_name and p.tablename = t.table_name
                         and p.permissive = 'PERMISSIVE') then
          raise;
        end if;
        raise notice 'assistant allow list: %.% is out of reach and already closed to every signed-in caller',
          t.schema_name, t.table_name;
      end;
    end if;
  end loop;
end
$$;

-- The three adds. Each is the person's own ordinary insert rule (the
-- permissive policies already on the table still have to admit it),
-- narrowed to a fresh row: nothing an assistant adds arrives already
-- resolved, parked, deleted, pulled from a source, or tied to a
-- meeting or an Aimee conversation it did not come from.

-- Roles: an assistant acting as the row's owner. Its own commitment,
-- open, with no resolution, park, deletion or provenance.
create policy assistant_insert on public.commitments
as restrictive for insert to authenticated
with check (
  not (select public.is_assistant())
  or (
    owner_id = (select auth.uid())
    and status = 'open'
    and completed_at is null
    and missed_reason is null
    and resolved_by_role is null
    and resolved_by_profile_id is null
    and deleted_at is null
    and parked_at is null
    and carried_from_id is null
    and source_meeting_id is null
    and coaching_message_id is null
  )
);

-- Roles: an assistant acting as a member of the company. An open
-- issue, not from a meeting. created_by is stamped by the database
-- (0268).
create policy assistant_insert on public.issues
as restrictive for insert to authenticated
with check (
  not (select public.is_assistant())
  or (
    status = 'open'
    and resolved_at is null
    and resolved_in_meeting = false
    and source_meeting_id is null
  )
);

-- Roles: an assistant acting as someone who may write the measure (its
-- function's lead or tracker, or an admin). A typed value, never one
-- dressed as a pull; never over an existing week, because an
-- assistant has no update rule. entered_by is stamped (0268).
create policy assistant_insert on public.success_measure_entries
as restrictive for insert to authenticated
with check (
  not (select public.is_assistant())
  or (origin is null and pulled_at is null)
);

-- ---- 4. Entry points: the pre-request gate ----------------------------

-- Runs before every PostgREST request, as the request's role. Anything
-- that is not an assistant returns at once. For an assistant, the
-- method and path must be on the menu or the request ends here with
-- 403, before it reaches a table or a function.
-- Roles: none. Admits nothing; refuses an assistant off the menu.
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

comment on function public.assistant_request_gate() is
  'PostgREST pre-request hook: refuses an outside assistant any path and method not on the menu (0270).';

grant execute on function public.assistant_request_gate() to anon, authenticated, service_role;

alter role authenticator set pgrst.db_pre_request to 'public.assistant_request_gate';
notify pgrst, 'reload config';

-- ---- 5. New tables are born refusing ----------------------------------

-- The same shape as 0170's rls_auto_enable: a table created in public
-- from now on gets assistant_refused in the same statement. A table
-- that belongs on the menu is added to it deliberately, by a migration
-- that replaces the refusal and updates the harness's menu, which
-- otherwise fails.
-- Roles: none. Adds a refusal; admits nothing.
create or replace function public.assistant_refuse_new_tables()
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
       and schema_name = 'public'
  loop
    begin
      execute format(
        'create policy assistant_refused on %s as restrictive for all to authenticated '
        'using (not (select public.is_assistant())) with check (not (select public.is_assistant()))',
        cmd.object_identity);
    exception
      when duplicate_object then null;
      when others then
        raise log 'assistant_refuse_new_tables: failed on %', cmd.object_identity;
    end;
  end loop;
end;
$function$;

drop event trigger if exists assistant_refuse_new_tables;
create event trigger assistant_refuse_new_tables
  on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  execute function public.assistant_refuse_new_tables();
