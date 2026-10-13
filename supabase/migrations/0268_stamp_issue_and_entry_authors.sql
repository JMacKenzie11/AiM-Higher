-- 0268: who raised an issue, and who entered a measure value, are
-- stamped by the database rather than taken from the caller.
--
-- WHY. issues.created_by and success_measure_entries.entered_by were
-- whatever the client sent. issues_insert_member checks only the
-- company, and the entry rules check only who may write the measure,
-- so a hand-rolled request could raise an issue in a colleague's name
-- or enter a number as somebody else. For issues it is more than a
-- label: issues_update_creator gives the creator edit rights, so a
-- forged created_by hands those rights to whoever was named.
-- Commitments, priorities, goals and focus areas have been stamped
-- since 0225. Found while scoping the outside assistant work (Jason,
-- 2026-10-13: an assistant adds things only ever as the person).
--
-- WHAT.
--   issues                    stamp_created_by (0225's function) on
--                             insert: created_by is the caller.
--   success_measure_entries   stamp_entered_by on insert and on any
--                             update that changes the value: entered_by
--                             is the caller. An upsert over an existing
--                             week is an update, and the person who
--                             typed the new number is who entered it,
--                             which is what the app already sends.
--
-- WHO IT LEAVES ALONE. The service role and migrations, whose
-- auth.uid() is null: the scheduled pull writes entries with no actor
-- on purpose (0213), and the off-target issue cron raises issues with
-- none. A pull a person runs goes through record_external_pull, which
-- already passes auth.uid() as the actor, so the stamp agrees with it.

-- Roles: none. A trigger, not a write rule: it admits no write, it
-- sets one column to the caller on writes other rules already admit.
drop trigger if exists stamp_created_by on public.issues;
create trigger stamp_created_by
  before insert on public.issues
  for each row execute function public.stamp_created_by();

comment on column public.issues.created_by is
  'Who raised this issue. Stamped from the signed-in caller on insert (0268), so it cannot be supplied by a client; '
  'null on rows written by the service role (the off-target cron). issues_update_creator reads it.';

-- SECURITY INVOKER (the default, stated for the reader): auth.uid()
-- must resolve to the caller, as in stamp_created_by.
create or replace function public.stamp_entered_by()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT'
     or new.value_number is distinct from old.value_number
     or new.value_text is distinct from old.value_text then
    new.entered_by := auth.uid();
  else
    new.entered_by := old.entered_by;
  end if;
  return new;
end;
$$;

comment on function public.stamp_entered_by() is
  'BEFORE INSERT OR UPDATE trigger on success_measure_entries: records the signed-in caller as who entered the value '
  'whenever the value is written or changed, and keeps the previous author on an update that leaves the value alone. '
  'Leaves the service role''s explicit value (including null) untouched (0268).';

drop trigger if exists stamp_entered_by on public.success_measure_entries;
create trigger stamp_entered_by
  before insert or update on public.success_measure_entries
  for each row execute function public.stamp_entered_by();

comment on column public.success_measure_entries.entered_by is
  'Who typed it. Stamped from the signed-in caller whenever the value is written or changed (0268), so it cannot be '
  'supplied by a client. NULL when nobody did: the scheduled pull writes entries with no actor, because inventing one '
  'would put a person''s name on a number they did not enter. Read origin and external_pull_log to find out where a '
  'NULL-actor value came from.';
