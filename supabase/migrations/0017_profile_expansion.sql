-- =============================================================
-- Merger Phase 2 — Migration 0017: profile expansion.
--   Adopts Strengths Map's structured profile fields ahead of the
--   full SM code merge. Existing full_name reads AND writes keep
--   working via a BEFORE INSERT/UPDATE trigger that keeps
--   first_name + last_name and full_name in sync bidirectionally:
--
--     - Structured write (first_name / last_name changed) →
--       full_name recomputed as "first last" (trimmed).
--     - Legacy write (only full_name changed) → split back into
--       first_name / last_name on the first space.
--
--   reports_to lays groundwork for an org-chart surface later —
--   Strengths Map has it, AiMSHigher doesn't yet.
-- =============================================================

alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists hire_date date,
  add column if not exists position_start_date date,
  add column if not exists reports_to uuid references public.profiles(id) on delete set null;

-- Backfill first_name / last_name from existing full_name.
-- Naive split: first token = first_name, remainder = last_name.
-- Runs only on rows the trigger hasn't populated yet.
update public.profiles
set
  first_name = case
    when position(' ' in full_name) > 0
      then substring(full_name from 1 for position(' ' in full_name) - 1)
    else full_name
  end,
  last_name = case
    when position(' ' in full_name) > 0
      then substring(full_name from position(' ' in full_name) + 1)
    else null
  end
where first_name is null;

create or replace function public.sync_profile_names()
returns trigger
language plpgsql
as $$
declare
  first_changed boolean;
  last_changed boolean;
  full_changed boolean;
  space_pos int;
begin
  if tg_op = 'INSERT' then
    first_changed := new.first_name is not null;
    last_changed := new.last_name is not null;
    full_changed := new.full_name is not null;
  else
    first_changed := new.first_name is distinct from old.first_name;
    last_changed := new.last_name is distinct from old.last_name;
    full_changed := new.full_name is distinct from old.full_name;
  end if;

  -- Structured fields win: if either changed, recompute full_name.
  if first_changed or last_changed then
    new.full_name := trim(both ' ' from
      coalesce(new.first_name, '') || ' ' || coalesce(new.last_name, ''));
    return new;
  end if;

  -- Legacy path: only full_name was written. Split it back so the
  -- structured fields stay populated for callers that expect them.
  if full_changed and new.full_name is not null then
    space_pos := position(' ' in new.full_name);
    if space_pos > 0 then
      new.first_name := substring(new.full_name from 1 for space_pos - 1);
      new.last_name := substring(new.full_name from space_pos + 1);
    else
      new.first_name := new.full_name;
      new.last_name := null;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_sync_names on public.profiles;

create trigger profiles_sync_names
before insert or update of first_name, last_name, full_name on public.profiles
for each row execute function public.sync_profile_names();

create index if not exists profiles_reports_to_idx
  on public.profiles (reports_to)
  where reports_to is not null;
