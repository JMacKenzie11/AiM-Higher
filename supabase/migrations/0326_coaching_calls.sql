-- =============================================================
-- Migration 0326: coaching calls
--
-- WHY. Jason, 2026-11-16. A coach (aims_guide, "Coach" in the app)
-- holds calls with a client company's leaders. Those transcripts
-- belong in AiMS, but they are not team meetings: B&B Electric's were
-- loaded as ordinary meetings, everyone at the company could read
-- them and Aimee quoted them, and they were deleted by hand. This
-- migration makes that impossible rather than unlikely.
--
-- WHO READS A COACHING CALL. Exactly two kinds of person:
--   (a) the company's assigned coaches: a guide_assignments row for
--       the company, held by a profile whose role is aims_guide or
--       system_admin; and
--   (b) the company's current AiMS Champion
--       (companies.aims_champion_profile_id). Change the champion and
--       access moves with the column.
-- NOT a portfolio admin (assigned or switched on), NOT an unassigned
-- system admin, NOT the company's admins or anyone else there. That is
-- why can_read_coaching_call() below reads guide_assignments directly
-- and never calls is_guide_for() or is_admin_for(): since 0199 both
-- admit assigned portfolio admins (E19).
--
-- WHAT CHANGES.
--   1. meetings.kind ('team' | 'coaching', default 'team'), and
--      meetings.routed_by_person_id: who on a coach's call matched it
--      to its company ("matched Dana Ruiz on the call").
--   2. A RESTRICTIVE policy on meetings and on meeting_analyses. It
--      ANDs with every existing read and write rule, so no existing
--      rule can admit a coaching row to anyone outside (a) and (b),
--      however it was written. Team rows pass it unchanged.
--   3. A permissive read rule on each for the two readers, so a
--      champion who is not otherwise able to read the company's
--      meetings still reads its calls.
--   4. A trigger that keeps a meeting's kind fixed for anyone signed
--      in. A coaching call cannot be turned into a team meeting (and
--      shown to the company) from the app's side of the database.
--   5. transcript_sources: kind (a company's Drive folder or Teams
--      meeting can be marked 'coaching'), owner_profile_id and a new
--      scope 'coach' for a coach's own folder holding calls with all
--      their clients. Changing a source's kind is for that company's
--      assigned coaches (trigger), because flipping a coaching folder
--      back to 'team' would send its next calls to everyone. A coach
--      (aims_guide or system_admin) writes their own coach-scope
--      source, and files that folder's unsorted calls into companies
--      they coach, and nowhere else (meetings_update_coach_sort).
--   6. coach_connections: a coach's own Google connection, secret in
--      Supabase Vault like a company's (0257), through functions only.
--   7. assistant_meeting_summaries (0270), what the MCP server's
--      meeting_summaries tool reads, returns team meetings only. It
--      is SECURITY INVOKER, so for a coach's assistant the coaching
--      read rule would otherwise let calls through.
--
-- WHAT DOES NOT. No existing permissive rule is rewritten: the
-- restrictive policy is the one place the boundary lives. Every app
-- reader that must not see coaching calls also filters kind = 'team'
-- explicitly (Aimee, the scorecard, HQ, the MCP server), because the
-- service-role client bypasses all of this and a coach's own client
-- passes it.
--
-- Probes: scripts/rls-harness.ts, coachingCallReadProbes.
-- =============================================================

-- ---- 1. meetings ---------------------------------------------------

alter table public.meetings
  add column if not exists kind text not null default 'team';

alter table public.meetings
  drop constraint if exists meetings_kind_check;
alter table public.meetings
  add constraint meetings_kind_check check (kind in ('team', 'coaching'));

alter table public.meetings
  add column if not exists routed_by_person_id uuid
    references public.profiles(id) on delete set null;

comment on column public.meetings.kind is
  'team: a company meeting, read by the company. coaching: a coach''s call '
  'with the company''s leaders, read only by its assigned coaches and its AiMS '
  'Champion (0326). Never read by Aimee.';
comment on column public.meetings.routed_by_person_id is
  'For a call from a coach''s own folder: the person on the call who matched '
  'it to its company (0326). Null when the file name matched, or nothing did.';

create index if not exists meetings_company_kind_created_idx
  on public.meetings (company_id, kind, created_at desc);

-- ---- 5. transcript_sources (before the helper that reads it) -------

alter table public.transcript_sources
  add column if not exists kind text not null default 'team';
alter table public.transcript_sources
  drop constraint if exists transcript_sources_kind_check;
alter table public.transcript_sources
  add constraint transcript_sources_kind_check check (kind in ('team', 'coaching'));

alter table public.transcript_sources
  add column if not exists owner_profile_id uuid
    references public.profiles(id) on delete cascade;

alter table public.transcript_sources
  drop constraint if exists transcript_sources_scope_check;
alter table public.transcript_sources
  add constraint transcript_sources_scope_check
  check (scope in ('company', 'shared', 'coach'));

alter table public.transcript_sources
  drop constraint if exists transcript_sources_scope_shape;
alter table public.transcript_sources
  add constraint transcript_sources_scope_shape check (
       (scope = 'company' and company_id is not null and owner_profile_id is null)
    or (scope = 'shared'  and company_id is null     and owner_profile_id is null)
    or (scope = 'coach'   and company_id is null     and owner_profile_id is not null and kind = 'coaching')
  );

create index if not exists transcript_sources_owner_idx
  on public.transcript_sources (owner_profile_id)
  where owner_profile_id is not null;

comment on column public.transcript_sources.kind is
  'coaching: every file from this source lands as a coaching call (0326).';
comment on column public.transcript_sources.owner_profile_id is
  'scope = coach: the coach whose own folder this is (0326).';

-- ---- 2/3. Who reads a coaching call --------------------------------

-- An assigned coach of the company: a guide_assignments row held by an
-- active aims_guide or system_admin. Read directly, never through
-- is_guide_for()/is_admin_for(), which admit assigned portfolio admins.
create or replace function public.is_assigned_coach(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select auth.uid()) is not null
    and not public.is_assistant()
    and p_company_id is not null
    and exists (
      select 1
        from public.guide_assignments ga
        join public.profiles p on p.id = ga.guide_id
       where ga.company_id = p_company_id
         and ga.guide_id = (select auth.uid())
         and p.role in ('aims_guide', 'system_admin')
         and p.status = 'active'
    ),
    false)
$$;

revoke all on function public.is_assigned_coach(uuid) from public, anon;
grant execute on function public.is_assigned_coach(uuid) to authenticated, service_role;

-- The two readers: an assigned coach, or the company's current AiMS
-- Champion. For a call from a coach's own folder that is still waiting
-- to be sorted (company_id null), the coach who owns that folder and
-- nobody else.
--
-- Never an assistant session (MCP): Aimee and the assistants do not
-- read coaching calls, for anyone.
create or replace function public.can_read_coaching_call(
  p_company_id uuid,
  p_source_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select auth.uid()) is not null
    and not public.is_assistant()
    and (
      (p_company_id is not null and (
        public.is_assigned_coach(p_company_id)
        or exists (
          select 1
            from public.companies c
            join public.profiles p on p.id = c.aims_champion_profile_id
           where c.id = p_company_id
             and c.aims_champion_profile_id = (select auth.uid())
             and p.status = 'active'
        )
      ))
      or (p_company_id is null and p_source_id is not null and exists (
        select 1
          from public.transcript_sources s
         where s.id = p_source_id
           and s.scope = 'coach'
           and s.owner_profile_id = (select auth.uid())
      ))
    ),
    false)
$$;

revoke all on function public.can_read_coaching_call(uuid, uuid) from public, anon;
grant execute on function public.can_read_coaching_call(uuid, uuid) to authenticated, service_role;

-- A meeting row passes the boundary: a team meeting, or a coaching call
-- the caller is one of the two readers of. Keyed by id for the child
-- tables (meeting_analyses), so their rule does not depend on the
-- meetings rules being applied inside a subquery.
create or replace function public.meeting_passes_kind_boundary(p_meeting_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select m.kind = 'team'
            or public.can_read_coaching_call(m.company_id, m.source_id)
       from public.meetings m
      where m.id = p_meeting_id),
    false)
$$;

revoke all on function public.meeting_passes_kind_boundary(uuid) from public, anon;
grant execute on function public.meeting_passes_kind_boundary(uuid) to authenticated, service_role;

-- THE BOUNDARY on meetings. Restrictive, for every command: it ANDs
-- with meetings_select, _select_member, _select_guide,
-- _select_portfolio and the three update rules, so none of them can
-- admit a coaching call to anyone else. Team rows pass unchanged.
-- Writes: no role gains a write here; it only narrows the existing
-- update rules (system_admin, the company's company_admin,
-- is_content_admin_for) to coaching calls the caller may read.
drop policy if exists meetings_coaching_boundary on public.meetings;
create policy meetings_coaching_boundary on public.meetings
  as restrictive for all to authenticated
  using (kind = 'team' or public.can_read_coaching_call(company_id, source_id))
  with check (kind = 'team' or public.can_read_coaching_call(company_id, source_id));

-- Reads: an assigned coach (aims_guide or system_admin with a
-- guide_assignments row) and the company's AiMS Champion; for an
-- unsorted call from a coach's own folder, that coach.
drop policy if exists meetings_select_coaching on public.meetings;
create policy meetings_select_coaching on public.meetings
  for select to authenticated
  using (kind = 'coaching' and public.can_read_coaching_call(company_id, source_id));

-- The same boundary on the analysis rows, keyed by their meeting.
-- Writes: none granted; narrows the existing ones (there are no
-- authenticated write rules on meeting_analyses today).
drop policy if exists meeting_analyses_coaching_boundary on public.meeting_analyses;
create policy meeting_analyses_coaching_boundary on public.meeting_analyses
  as restrictive for all to authenticated
  using (public.meeting_passes_kind_boundary(meeting_id))
  with check (public.meeting_passes_kind_boundary(meeting_id));

-- Reads: the two readers of the call the analysis belongs to.
drop policy if exists meeting_analyses_select_coaching on public.meeting_analyses;
create policy meeting_analyses_select_coaching on public.meeting_analyses
  for select to authenticated
  using (exists (
    select 1
      from public.meetings m
     where m.id = meeting_analyses.meeting_id
       and m.kind = 'coaching'
       and public.can_read_coaching_call(m.company_id, m.source_id)
  ));

-- ---- 4. A meeting's kind is fixed ----------------------------------
--
-- Signed-in callers cannot change it, whatever their role: the update
-- rules let a company admin edit a meeting row, and a coaching call
-- set to 'team' would be read by the whole company. The service-role
-- pipeline (no auth.uid()) is unaffected; nothing in the app changes a
-- meeting's kind after it is written.
create or replace function public.meetings_kind_is_fixed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and new.kind <> old.kind then
    raise exception 'a meeting''s kind cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists meetings_kind_is_fixed on public.meetings;
create trigger meetings_kind_is_fixed
  before update of kind on public.meetings
  for each row execute function public.meetings_kind_is_fixed();

-- ---- 5 (cont). Who may mark a source ---------------------------------
--
-- Write rule (trigger, alongside the existing insert/update rules):
-- creating a source with kind = 'coaching', or changing a source's
-- kind either way, is for an assigned coach of its company
-- (is_assigned_coach: aims_guide or system_admin with a
-- guide_assignments row). A coach-scope source is the owning coach's
-- own (owner_profile_id = auth.uid()). The service role is unaffected.
create or replace function public.transcript_sources_kind_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  if new.scope = 'coach' then
    if new.owner_profile_id is distinct from (select auth.uid()) then
      raise exception 'a coach''s own folder is theirs to manage' using errcode = '42501';
    end if;
    return new;
  end if;
  if (tg_op = 'INSERT' and new.kind = 'coaching')
     or (tg_op = 'UPDATE' and new.kind <> old.kind) then
    if not public.is_assigned_coach(new.company_id) then
      raise exception 'only the company''s coach can mark its coaching calls' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists transcript_sources_kind_guard on public.transcript_sources;
create trigger transcript_sources_kind_guard
  before insert or update on public.transcript_sources
  for each row execute function public.transcript_sources_kind_guard();

-- Reads: the coach who owns a coach-scope source.
drop policy if exists transcript_sources_select_owner on public.transcript_sources;
create policy transcript_sources_select_owner on public.transcript_sources
  for select to authenticated
  using (owner_profile_id = (select auth.uid()));

-- Writes: an aims_guide or system_admin, on a coach-scope source that
-- is their own (owner_profile_id = auth.uid()). Nobody else, and not on
-- any other scope: company and shared sources keep 0181's rules.
drop policy if exists transcript_sources_insert_coach on public.transcript_sources;
create policy transcript_sources_insert_coach on public.transcript_sources
  for insert to authenticated
  with check (
    scope = 'coach'
    and owner_profile_id = (select auth.uid())
    and (select public.auth_role()) in ('aims_guide', 'system_admin')
  );

-- Writes: an aims_guide or system_admin, on their own coach-scope source.
drop policy if exists transcript_sources_update_coach on public.transcript_sources;
create policy transcript_sources_update_coach on public.transcript_sources
  for update to authenticated
  using (
    scope = 'coach'
    and owner_profile_id = (select auth.uid())
    and (select public.auth_role()) in ('aims_guide', 'system_admin')
  )
  with check (
    scope = 'coach'
    and owner_profile_id = (select auth.uid())
    and (select public.auth_role()) in ('aims_guide', 'system_admin')
  );

-- Writes: an aims_guide or system_admin, on their own coach-scope source.
drop policy if exists transcript_sources_delete_coach on public.transcript_sources;
create policy transcript_sources_delete_coach on public.transcript_sources
  for delete to authenticated
  using (
    scope = 'coach'
    and owner_profile_id = (select auth.uid())
    and (select public.auth_role()) in ('aims_guide', 'system_admin')
  );

-- ---- Sorting a coach's calls ------------------------------------------
--
-- Write: the coach who owns a coach-scope source (an aims_guide or
-- system_admin; only they can own one, above), on a call from it that
-- is still waiting to be sorted (company_id null). They may file it
-- into a company they are an assigned coach of (is_assigned_coach),
-- or leave it unfiled and set it aside. Never into a company they do
-- not coach. Moving a call that is already filed is the existing
-- update rules (an assigned guide through is_content_admin_for, a
-- system admin), narrowed by the boundary above to coaching calls the
-- caller may read.
drop policy if exists meetings_update_coach_sort on public.meetings;
create policy meetings_update_coach_sort on public.meetings
  for update to authenticated
  using (
    kind = 'coaching'
    and company_id is null
    and public.can_read_coaching_call(null, source_id)
  )
  with check (
    kind = 'coaching'
    and (
      (company_id is null and public.can_read_coaching_call(null, source_id))
      or public.is_assigned_coach(company_id)
    )
  );

-- ---- 6. A coach's own Google connection ------------------------------
--
-- One per coach and connector. The shape of public.connections (0257),
-- keyed by the coach's profile instead of a company: a coach's folder
-- holds calls with every client, so it is nobody's company's
-- connection. The secret is in Supabase Vault and is reached only by
-- the service-role functions below.

create table if not exists public.coach_connections (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  connector text not null check (connector in ('google')),
  status text not null default 'active' check (status in ('active', 'error')),
  account_label text,
  scopes text[] not null default '{}',
  -- vault.secrets(id), kept in step by the functions below.
  secret_id uuid unique,
  checked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, connector)
);

comment on table public.coach_connections is
  'A coach''s own connection to an outside system (0326), for the folder '
  'holding their coaching calls. The secret is in Supabase Vault; written only '
  'by the coach_connection_* functions.';

alter table public.coach_connections enable row level security;
alter table public.coach_connections force row level security;
revoke all on public.coach_connections from public, anon, authenticated;
grant select on public.coach_connections to authenticated;
grant select, insert, update, delete on public.coach_connections to service_role;

-- Reads: the coach it belongs to, and nobody else (not a system admin:
-- it names the account their clients' calls come from).
drop policy if exists coach_connections_select_own on public.coach_connections;
create policy coach_connections_select_own on public.coach_connections
  for select to authenticated
  using (profile_id = (select auth.uid()) and not (select public.is_assistant()));

drop policy if exists assistant_refused on public.coach_connections;
create policy assistant_refused on public.coach_connections
  as restrictive for all to authenticated
  using (not (select public.is_assistant()))
  with check (not (select public.is_assistant()));

-- Write: service_role only (the Google sign-in callback, after its
-- route has checked the person is an aims_guide or system_admin
-- saving their own connection).
create or replace function public.coach_connection_put_service(
  p_profile_id uuid,
  p_connector text,
  p_secret text,
  p_account_label text,
  p_scopes text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.coach_connections;
  v_secret_id uuid;
begin
  if p_secret is null or length(btrim(p_secret)) = 0 then
    raise exception 'a connection needs a secret' using errcode = '22023';
  end if;
  select * into v_row from public.coach_connections
   where profile_id = p_profile_id and connector = p_connector
   for update;
  if v_row.id is null then
    insert into public.coach_connections (profile_id, connector)
    values (p_profile_id, p_connector)
    returning * into v_row;
  end if;
  if v_row.secret_id is null then
    v_secret_id := vault.create_secret(
      p_secret,
      'coach_connection:' || v_row.id::text,
      p_connector || ' connection for coach ' || p_profile_id::text
    );
  else
    perform vault.update_secret(v_row.secret_id, p_secret);
    v_secret_id := v_row.secret_id;
  end if;
  update public.coach_connections
     set secret_id = v_secret_id,
         account_label = p_account_label,
         scopes = coalesce(p_scopes, '{}'),
         status = 'active',
         last_error = null,
         checked_at = now(),
         updated_at = now()
   where id = v_row.id;
  return v_row.id;
end;
$$;

revoke all on function public.coach_connection_put_service(uuid, text, text, text, text[]) from public, anon, authenticated;
grant execute on function public.coach_connection_put_service(uuid, text, text, text, text[]) to service_role;

-- Write: service_role only. A refreshed access token, written back.
create or replace function public.coach_connection_refresh_secret(
  p_profile_id uuid,
  p_connector text,
  p_secret text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
begin
  select secret_id into v_secret_id from public.coach_connections
   where profile_id = p_profile_id and connector = p_connector;
  if v_secret_id is null then
    return false;
  end if;
  perform vault.update_secret(v_secret_id, p_secret);
  return true;
end;
$$;

revoke all on function public.coach_connection_refresh_secret(uuid, text, text) from public, anon, authenticated;
grant execute on function public.coach_connection_refresh_secret(uuid, text, text) to service_role;

-- Read: service_role only. Server code reading the coach's folder.
create or replace function public.coach_connection_secret(p_profile_id uuid, p_connector text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select ds.decrypted_secret
    from public.coach_connections c
    join vault.decrypted_secrets ds on ds.id = c.secret_id
   where c.profile_id = p_profile_id
     and c.connector = p_connector
$$;

revoke all on function public.coach_connection_secret(uuid, text) from public, anon, authenticated;
grant execute on function public.coach_connection_secret(uuid, text) to service_role;

-- Write: service_role only (the coach disconnecting, after the action
-- has checked it is their own; npm run scrub:dev). Deletes the secret,
-- then the row.
create or replace function public.coach_connection_remove_service(p_profile_id uuid, p_connector text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.coach_connections;
begin
  select * into v_row from public.coach_connections
   where profile_id = p_profile_id and connector = p_connector
   for update;
  if v_row.id is null then
    return false;
  end if;
  if v_row.secret_id is not null then
    delete from vault.secrets where id = v_row.secret_id;
  end if;
  delete from public.coach_connections where id = v_row.id;
  return true;
end;
$$;

revoke all on function public.coach_connection_remove_service(uuid, text) from public, anon, authenticated;
grant execute on function public.coach_connection_remove_service(uuid, text) to service_role;

-- ---- 7. The MCP server's meeting summaries: team meetings only -------
--
-- 0270's function, as it stands on the fleet, with one line added:
-- m.kind = 'team'.
create or replace function public.assistant_meeting_summaries(
  p_company_id uuid,
  p_limit integer default 8,
  p_meeting_id uuid default null
)
returns table(
  meeting_id uuid,
  meeting_title text,
  held_at timestamp with time zone,
  summary text,
  commitments jsonb,
  truncated boolean
)
language plpgsql
set search_path to ''
as $function$
begin
  perform set_config('aims.assistant_scope', 'meeting_summaries', true);
  return query
    select m.id, m.meeting_title, m.created_at, a.analysis_markdown, a.commitments_json, coalesce(a.truncated, false)
      from public.meetings m
      left join public.meeting_analyses a on a.meeting_id = m.id
     where m.company_id = p_company_id
       and m.kind = 'team'
       and m.status = 'complete'
       and (p_meeting_id is null or m.id = p_meeting_id)
     order by m.created_at desc
     limit least(greatest(coalesce(p_limit, 8), 1), 20);
  perform set_config('aims.assistant_scope', '', true);
exception when others then
  perform set_config('aims.assistant_scope', '', true);
  raise;
end;
$function$;
