-- 0291: a log of every change to a critical success factor's value.
--
-- WHY. Jeff, all-hands 2026-10-19, and Jason the same day: people
-- should be able to go back and correct an older week's number rather
-- than being stopped, and the system should keep a record of who
-- changed it and when instead. That includes typing over a value an
-- outside system pulled in (external connections, 0212 onward).
--
-- WHAT. success_measure_entry_changes: one row per add, change or
-- removal of a value in success_measure_entries, written by a trigger
-- on that table, so no path can write a value without leaving a row:
-- the /measures grid, an outside AI app, an external pull, a script.
-- Each row keeps the week, the value before and after, where each
-- came from (`origin`: null when a person typed it, the connector's
-- name when it was pulled), who did it (the signed-in person, or null
-- when a scheduled pull ran with no one signed in) and when. An update
-- that changes neither the value nor its origin is not logged.
--
-- No foreign keys to the measure or the company, on purpose. The log
-- is a record: deleting a measure cascades to its values, and a row
-- written in that cascade would have nothing left to point at. When a
-- measure is deleted outright, its values' removals are not logged;
-- the measure going is its own event.
--
-- WHO READS AND WRITES. Reads: as the values themselves, wide: the
-- company's own people, an assigned guide, a system admin, a portfolio
-- admin. Writes: nobody signed in. The trigger alone adds rows, as
-- the table's owner; there is no insert, update or delete grant, so a
-- row cannot be added by hand, edited or taken out. Outside AI apps
-- are refused at birth by 0270's event trigger.
--
-- Harness probe "value changes · logged, and read only".

create table if not exists public.success_measure_entry_changes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  measure_id uuid not null,
  week_ending date not null,
  action text not null check (action in ('added', 'changed', 'removed')),
  old_number numeric,
  old_text text,
  old_origin text,
  new_number numeric,
  new_text text,
  new_origin text,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now()
);

create index if not exists success_measure_entry_changes_measure_week
  on public.success_measure_entry_changes (measure_id, week_ending, changed_at desc);
create index if not exists success_measure_entry_changes_company
  on public.success_measure_entry_changes (company_id, changed_at desc);

comment on table public.success_measure_entry_changes is
  'Every add, change and removal of a critical success factor value: the week, before and after, where each came from, who and when. Written only by a trigger on success_measure_entries (0291).';

-- Roles: none. Writes the log row; admits nobody to anything. Security
-- definer, as the table's owner, because nobody signed in may write
-- the log.
create or replace function public.log_measure_entry_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_measure uuid := coalesce(new.measure_id, old.measure_id);
  v_company uuid;
begin
  select m.company_id into v_company from public.success_measures m where m.id = v_measure;
  -- The measure itself is being deleted: nothing to log against.
  if v_company is null then
    return null;
  end if;

  if tg_op = 'INSERT' then
    insert into public.success_measure_entry_changes
      (company_id, measure_id, week_ending, action, new_number, new_text, new_origin, changed_by)
    values (v_company, v_measure, new.week_ending, 'added', new.value_number, new.value_text, new.origin, auth.uid());
  elsif tg_op = 'UPDATE' then
    if new.value_number is not distinct from old.value_number
       and new.value_text is not distinct from old.value_text
       and new.origin is not distinct from old.origin
       and new.week_ending is not distinct from old.week_ending then
      return null;
    end if;
    insert into public.success_measure_entry_changes
      (company_id, measure_id, week_ending, action, old_number, old_text, old_origin, new_number, new_text, new_origin, changed_by)
    values (v_company, v_measure, new.week_ending, 'changed', old.value_number, old.value_text, old.origin,
            new.value_number, new.value_text, new.origin, auth.uid());
  else
    insert into public.success_measure_entry_changes
      (company_id, measure_id, week_ending, action, old_number, old_text, old_origin, changed_by)
    values (v_company, v_measure, old.week_ending, 'removed', old.value_number, old.value_text, old.origin, auth.uid());
  end if;
  return null;
end;
$$;

revoke all on function public.log_measure_entry_change() from public, anon, authenticated;

drop trigger if exists log_measure_entry_change on public.success_measure_entries;
create trigger log_measure_entry_change
  after insert or update or delete on public.success_measure_entries
  for each row execute function public.log_measure_entry_change();

alter table public.success_measure_entry_changes enable row level security;
alter table public.success_measure_entry_changes force row level security;

revoke all on public.success_measure_entry_changes from public, anon, authenticated;
grant select on public.success_measure_entry_changes to authenticated;
grant select, insert, update, delete on public.success_measure_entry_changes to service_role;

-- Roles: the company's own people (any role with that company_id), an
-- assigned aims_guide, system_admin. Read only.
drop policy if exists success_measure_entry_changes_select on public.success_measure_entry_changes;
create policy success_measure_entry_changes_select on public.success_measure_entry_changes
  for select to authenticated
  using (
    (select public.auth_role()) = 'system_admin'
    or ((select public.auth_company_id()) is not null
        and (select public.auth_company_id()) = success_measure_entry_changes.company_id)
    or public.is_guide_for(company_id)
  );

-- Roles: portfolio_admin, read only.
drop policy if exists success_measure_entry_changes_select_portfolio on public.success_measure_entry_changes;
create policy success_measure_entry_changes_select_portfolio on public.success_measure_entry_changes
  for select to authenticated
  using ((select public.is_portfolio_admin()));
