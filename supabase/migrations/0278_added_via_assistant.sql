-- 0278: a commitment, issue or measure value added through an outside
-- assistant says so, and which one.
--
-- WHY. Jason, 2026-10-13 and 2026-10-14 (Phase 3): anything added this
-- way is clearly marked as added through an outside assistant, under
-- the person's name, and the database fills the mark from the token so
-- it can be neither skipped nor faked.
--
-- WHAT. Two columns on each of the three tables an assistant may add to:
--   added_via_client_id   the OAuth client_id the token carried
--   added_via_assistant   that client's name when the row was added, as
--                         registered with this project's OAuth server
-- A BEFORE trigger owns both. On insert it sets them from the request's
-- token when the caller is an assistant (is_assistant(), 0270), and
-- clears them for every other caller, so an app user, the service role
-- or a forged value in the request can never set them. On update it
-- puts back what was there, so nobody can add or remove the mark later.
-- SECURITY DEFINER because auth.oauth_clients is not readable by the
-- request's own role.

alter table public.commitments
  add column if not exists added_via_client_id text,
  add column if not exists added_via_assistant text;
alter table public.issues
  add column if not exists added_via_client_id text,
  add column if not exists added_via_assistant text;
alter table public.success_measure_entries
  add column if not exists added_via_client_id text,
  add column if not exists added_via_assistant text;

comment on column public.commitments.added_via_assistant is
  'Name of the outside assistant this was added through, set by the database from the token (0278). Null when added any other way.';
comment on column public.issues.added_via_assistant is
  'Name of the outside assistant this was added through, set by the database from the token (0278). Null when added any other way.';
comment on column public.success_measure_entries.added_via_assistant is
  'Name of the outside assistant this was added through, set by the database from the token (0278). Null when added any other way.';

-- Roles: none. Stamps the row it fires on; admits nobody to anything.
create or replace function public.stamp_added_via()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid text;
begin
  if tg_op = 'UPDATE' then
    new.added_via_client_id := old.added_via_client_id;
    new.added_via_assistant := old.added_via_assistant;
    return new;
  end if;
  if public.is_assistant() then
    cid := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'client_id';
    new.added_via_client_id := cid;
    new.added_via_assistant := coalesce(
      (select nullif(btrim(c.client_name), '') from auth.oauth_clients c where c.id::text = cid),
      'an outside assistant');
  else
    new.added_via_client_id := null;
    new.added_via_assistant := null;
  end if;
  return new;
end;
$$;

comment on function public.stamp_added_via() is
  'BEFORE INSERT OR UPDATE: marks a row added through an outside assistant from the token, clears the mark for anyone else, and never lets an update change it (0278).';

revoke all on function public.stamp_added_via() from public;

drop trigger if exists stamp_added_via on public.commitments;
create trigger stamp_added_via
  before insert or update on public.commitments
  for each row execute function public.stamp_added_via();

drop trigger if exists stamp_added_via on public.issues;
create trigger stamp_added_via
  before insert or update on public.issues
  for each row execute function public.stamp_added_via();

drop trigger if exists stamp_added_via on public.success_measure_entries;
create trigger stamp_added_via
  before insert or update on public.success_measure_entries
  for each row execute function public.stamp_added_via();
