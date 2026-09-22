-- 0225: who created this row, on the four plan tables.
--
-- RENUMBERED FROM 0221, and not because anything was wrong with it.
-- Two sessions branched from main at 0220 on the same day and both
-- took the next number; the role-description work merged first and
-- reached the fleet, so production sat at 0224 while this file still
-- said 0221.
--
-- That is not a conflict the runner would have reported. It tracks
-- one high-water mark per instance and skips anything at or below
-- it, so this migration would have merged, passed CI, and been
-- silently never applied — the columns absent in production while
-- every instance reported itself current.
--
-- WHY. Howard Concrete Pumping's plan was typed in one level too high
-- on 2026-08-18 — sixteen quarterly priorities that were a commitment
-- list — and Benson's the same way a week earlier. Asked who had done
-- it, the honest answer was "the database does not record that, and it
-- is not recoverable": `priorities`, `annual_goals`,
-- `strategic_focus_areas` and `commitments` carry no attribution, no
-- audit table covers plan writes, and the request logs from August are
-- long gone.
--
-- `issues.created_by` has existed since 0143 and is the shape copied
-- here: nullable uuid, FK to profiles, ON DELETE SET NULL so removing
-- a person never removes their work, and an index because the useful
-- question is "everything this person created".
--
-- NULL MEANS "BEFORE THIS MIGRATION", and nothing backfills it.
-- Guessing an author for existing rows would put a name on work
-- somebody else may have done, which is worse than an honest blank.
--
-- NOT A PERMISSION. Every policy on these tables stays exactly as it
-- is; this column is read by people, not by RLS. `issues` uses its
-- created_by in an update policy and that is deliberate there — the
-- creator may edit their own issue. Nothing of the kind applies to a
-- plan: a quarterly priority belongs to the company, not to whoever
-- happened to type it.

-- ---- the column -------------------------------------------------

alter table public.strategic_focus_areas
  add column if not exists created_by uuid
  references public.profiles(id) on delete set null;

alter table public.annual_goals
  add column if not exists created_by uuid
  references public.profiles(id) on delete set null;

alter table public.priorities
  add column if not exists created_by uuid
  references public.profiles(id) on delete set null;

alter table public.commitments
  add column if not exists created_by uuid
  references public.profiles(id) on delete set null;

create index if not exists strategic_focus_areas_created_by_idx
  on public.strategic_focus_areas (created_by)
  where created_by is not null;
create index if not exists annual_goals_created_by_idx
  on public.annual_goals (created_by)
  where created_by is not null;
create index if not exists priorities_created_by_idx
  on public.priorities (created_by)
  where created_by is not null;
create index if not exists commitments_created_by_idx
  on public.commitments (created_by)
  where created_by is not null;

-- ---- stamped by the database, not by the caller -------------------
--
-- A trigger rather than a column default, and rather than leaving it
-- to the server actions, for two reasons.
--
-- It cannot be forged. For an authenticated caller the trigger
-- OVERWRITES whatever arrived, so a hand-rolled PostgREST request
-- cannot attribute its write to somebody else. A field that answers
-- "who did this" is worth nothing if the answer is whatever the
-- client claimed.
--
-- And it cannot be forgotten. Setting it in each action would work
-- until the next insert path is added — and the reason this column
-- exists is that nobody could say which path wrote Howard's rows.
--
-- auth.uid() is NULL for the service role, which is how the seeds,
-- the transcript pipeline and the provisioning CLI write. Those keep
-- whatever they pass explicitly, including nothing: a row created by
-- a cron has no person behind it and should not borrow one.
--
-- SECURITY INVOKER (the default, stated for the reader): auth.uid()
-- must resolve to the caller. A SECURITY DEFINER function here would
-- read the owner's context and stamp every row with the same id.

create or replace function public.stamp_created_by()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

comment on function public.stamp_created_by() is
  'BEFORE INSERT trigger: records the authenticated caller as the row''s author. Overwrites any value supplied by an authenticated client so attribution cannot be forged; leaves an explicit value alone for the service role, whose auth.uid() is null.';

drop trigger if exists stamp_created_by on public.strategic_focus_areas;
create trigger stamp_created_by
  before insert on public.strategic_focus_areas
  for each row execute function public.stamp_created_by();

drop trigger if exists stamp_created_by on public.annual_goals;
create trigger stamp_created_by
  before insert on public.annual_goals
  for each row execute function public.stamp_created_by();

drop trigger if exists stamp_created_by on public.priorities;
create trigger stamp_created_by
  before insert on public.priorities
  for each row execute function public.stamp_created_by();

drop trigger if exists stamp_created_by on public.commitments;
create trigger stamp_created_by
  before insert on public.commitments
  for each row execute function public.stamp_created_by();

comment on column public.strategic_focus_areas.created_by is
  'Who created this row. Null on anything created before migration 0221, and on rows written by the service role. Informational: no policy reads it.';
comment on column public.annual_goals.created_by is
  'Who created this row. Null on anything created before migration 0221, and on rows written by the service role. Informational: no policy reads it.';
comment on column public.priorities.created_by is
  'Who created this row. Null on anything created before migration 0221, and on rows written by the service role. Informational: no policy reads it.';
comment on column public.commitments.created_by is
  'Who created this row. Null on anything created before migration 0221, and on rows written by the service role. Informational: no policy reads it.';
