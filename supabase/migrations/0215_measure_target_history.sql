-- =============================================================
-- Migration 0215: a target has a history
--
-- `success_measures.target` is one text column with no history, so
-- editing it silently re-judges every week already logged. Lower a
-- target from 60 to 55 in September and three months of misses become
-- hits, with no new data behind any of them. The chart changes shape
-- and nothing on the screen says why.
--
-- After this, a week is judged against the target that was in force
-- when that week closed. Weeks already closed stop moving.
--
-- ---- WHY THE CURRENT TARGET STAYS ON THE MEASURE ---------------
--
-- `success_measures.target` is not dropped and does not become
-- derived. Roughly forty read paths want "the target now" and none of
-- them should have to learn about effective dates to get it. The
-- column keeps that answer; this table keeps the rest.
--
-- The two cannot drift, because nothing writes the history by hand:
-- a trigger on success_measures writes it, in the same statement as
-- the update that changed the target. There is no path that edits one
-- without the other.
--
-- ---- WHY A TRIGGER AND NOT A FUNCTION THE APP CALLS -----------
--
-- 0214 reached for a SECURITY DEFINER function because PostgREST
-- gives the app no transaction across statements. That argument
-- applies here too, and a trigger answers it more completely: it is
-- the same statement, not merely the same transaction, and it cannot
-- be bypassed by a caller that does not know it exists.
--
-- That matters more than it sounds. The measure edit form, the seed
-- scripts, a future bulk import and anything else that has ever set a
-- target all get history without being touched. A function would have
-- meant finding every writer and trusting the next one to remember.
--
-- ---- APPEND-ONLY, LIKE external_pull_log ----------------------
--
-- No client may write this table. There is no INSERT, UPDATE or
-- DELETE policy and none of those verbs is granted to anyone, so both
-- walls are up: E8 says a policy decides which rows a verb may touch
-- and a grant decides whether the verb runs at all, and a
-- policy-shaped absence alone would be one wall.
--
-- The trigger writes it as the definer. `postgres` carries
-- rolbypassrls, and BYPASSRLS beats FORCE ROW LEVEL SECURITY, so this
-- table's policies do not constrain the trigger — measured in 0212,
-- and stated here rather than implied. That is deliberate: the gate on
-- writing history is the UPDATE on success_measures that fired the
-- trigger, which has already been through that table's own policies.
-- A second gate here could only ever disagree with the first, and a
-- measure whose target changed without a history row is the one state
-- this migration exists to prevent.
--
-- ---- WHEN A CHANGE TAKES EFFECT -------------------------------
--
-- From the week in progress. Change a target on Wednesday and the
-- week ending that Friday is judged by the new number; the weeks
-- already closed are not. effective_from is therefore a Friday, the
-- same Friday a week_ending is, so the lookup compares like with like.
--
-- In the COMPANY'S timezone, not the server's. Editing at 20:00 on a
-- Friday in Vancouver is Saturday in UTC, and a UTC answer would push
-- the change into next week after the person watched this week's row
-- on screen while they typed.
--
-- ---- A NULL TARGET IS A ROW, NOT AN ABSENCE -------------------
--
-- Clearing a target has to be recorded, or the lookup keeps finding
-- the old row and keeps judging new weeks against a number nobody
-- wants any more. So `target` is nullable here and a null row means
-- "no target in force from this date". A measure that has never had a
-- target has no rows at all, which reads as no target and needs
-- nothing written.
-- =============================================================

-- ---- 1. The Friday a date's week ends on ----------------------
--
-- Weeks end Friday and run Saturday to Friday. This is fridayOf() in
-- src/lib/dates.ts, in SQL, with the same arithmetic: Saturday and
-- Sunday belong to the week ending the FOLLOWING Friday, which is why
-- the modulo is there rather than a simple date_trunc.
--
-- extract(dow) is 0=Sunday … 6=Saturday, matching JS getUTCDay(), so
-- the two implementations can be compared line for line.
create or replace function public.friday_of(p_date date)
returns date
language sql
immutable
set search_path = public
as $$
  select p_date + ((5 - extract(dow from p_date)::int + 7) % 7);
$$;

comment on function public.friday_of(date) is
  'The Friday ending the week containing p_date, weeks running Saturday to Friday. The SQL twin of fridayOf() in src/lib/dates.ts.';

-- ---- 2. The table --------------------------------------------
create table if not exists public.success_measure_targets (
  id uuid primary key default gen_random_uuid(),
  measure_id uuid not null
    references public.success_measures(id) on delete cascade,
  -- Null means the target was cleared as of this date. See the header.
  target text,
  -- Carried WITH the target, not read from the measure. Judging a week
  -- needs all three, and a target moving from '30%' to '0.30' changes
  -- its type: a past week has to keep the reading it was judged under,
  -- not acquire today's.
  value_type text not null default 'number'
    check (value_type in ('number','percent','text')),
  target_direction text not null default 'higher_is_better'
    check (target_direction in ('higher_is_better','lower_is_better')),
  -- Always a Friday, so it compares directly with entries.week_ending.
  effective_from date not null,
  created_at timestamptz not null default now(),
  -- Null for the backfill, and for anything a scheduled job changes.
  created_by uuid references public.profiles(id) on delete set null,
  -- Two edits on the same day are one decision, not two. The later
  -- one replaces the earlier rather than raising, which is what the
  -- trigger's ON CONFLICT relies on.
  constraint success_measure_targets_one_per_day unique (measure_id, effective_from)
);

-- The only read this table serves: the target in force for a measure
-- as of a week. DESC so the lookup is a backwards index scan stopping
-- at the first row.
create index if not exists success_measure_targets_lookup_idx
  on public.success_measure_targets (measure_id, effective_from desc);

comment on table public.success_measure_targets is
  'The target in force for a measure, by date. A week is judged against the row with the greatest effective_from <= that week_ending; a null target on that row means no target applies. Append-only by construction: no INSERT, UPDATE or DELETE policy exists, none of those verbs is granted to anyone, and rows are written only by the trigger on success_measures.';

comment on column public.success_measure_targets.target is
  'Null means the target was cleared as of effective_from. A measure that never had one has no rows here at all.';

comment on column public.success_measure_targets.effective_from is
  'Always a Friday, in the company timezone, so it compares directly with success_measure_entries.week_ending. A change lands on the week in progress.';

-- ---- 3. RLS ---------------------------------------------------
--
-- Reads mirror success_measure_entries exactly: the company's own
-- people, a guide assigned to the company, and portfolio admins.
-- Form D throughout, with auth_role() and auth_company_id() hoisted
-- into scalar subqueries so they run once per statement.
--
-- There is no write policy, on purpose. See the header.
alter table public.success_measure_targets enable row level security;
alter table public.success_measure_targets force row level security;

drop policy if exists success_measure_targets_select on public.success_measure_targets;
create policy success_measure_targets_select on public.success_measure_targets
for select to authenticated
using (
  exists (
    select 1
    from public.success_measures m
    join public.functions f on f.id = m.function_id
    where m.id = public.success_measure_targets.measure_id
      and (
        (select public.auth_role()) = 'system_admin'
        or (
          (select public.auth_company_id()) is not null
          and (select public.auth_company_id()) = f.company_id
        )
      )
  )
);

-- aims_guide is company_admin on the companies it is assigned, so
-- every policy admitting company_admin needs this mirror.
drop policy if exists success_measure_targets_select_guide on public.success_measure_targets;
create policy success_measure_targets_select_guide on public.success_measure_targets
for select to authenticated
using (
  exists (
    select 1
    from public.success_measures m
    join public.functions f on f.id = m.function_id
    where m.id = public.success_measure_targets.measure_id
      and public.is_guide_for(f.company_id)
  )
);

drop policy if exists success_measure_targets_select_portfolio on public.success_measure_targets;
create policy success_measure_targets_select_portfolio on public.success_measure_targets
for select to authenticated
using (
  (select public.is_portfolio_admin())
  and exists (
    select 1
    from public.success_measures m
    join public.functions f on f.id = m.function_id
    where m.id = public.success_measure_targets.measure_id
  )
);

-- ---- 4. Grants ------------------------------------------------
--
-- The revokes are what decides anything here. A policy-shaped absence
-- would leave INSERT reachable the moment somebody adds a policy
-- without thinking about the grant; withholding the verb means the
-- statement never runs whatever the policies say.
revoke all on public.success_measure_targets from public;
revoke all on public.success_measure_targets from anon;
revoke all on public.success_measure_targets from authenticated;
revoke all on public.success_measure_targets from service_role;

grant select on public.success_measure_targets to authenticated;
grant select on public.success_measure_targets to service_role;

-- ---- 5. The trigger that keeps the two in step ----------------
create or replace function public.record_measure_target()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz text;
  v_effective date;
begin
  -- Nothing judged has moved. sort_order, description and archived
  -- all update this row constantly and none of them changes how a
  -- week reads.
  if tg_op = 'UPDATE'
     and new.target is not distinct from old.target
     and new.value_type is not distinct from old.value_type
     and new.target_direction is not distinct from old.target_direction
  then
    return new;
  end if;

  -- A measure created without a target needs no row saying it has
  -- none. Absence already reads as no target.
  if tg_op = 'INSERT' and btrim(coalesce(new.target, '')) = '' then
    return new;
  end if;

  -- The company's Friday, not the server's. A measure with no
  -- function_id is a legacy row from before 0166; UTC is the only
  -- answer available and it is better than refusing the update.
  select c.timezone into v_tz
    from public.functions f
    join public.companies c on c.id = f.company_id
   where f.id = new.function_id;

  v_effective := public.friday_of(
    ((now() at time zone coalesce(v_tz, 'UTC'))::date)
  );

  insert into public.success_measure_targets
    (measure_id, target, value_type, target_direction, effective_from, created_by)
  values (
    new.id,
    -- Blank and null are the same statement: there is no target now.
    case when btrim(coalesce(new.target, '')) = '' then null else new.target end,
    new.value_type,
    new.target_direction,
    v_effective,
    auth.uid()
  )
  on conflict (measure_id, effective_from) do update
    set target           = excluded.target,
        value_type       = excluded.value_type,
        target_direction = excluded.target_direction,
        created_by       = excluded.created_by,
        created_at       = now();

  return new;
end;
$$;

comment on function public.record_measure_target() is
  'Writes the target history row for a measure whose target, value_type or target_direction just changed. Runs as the definer so this table needs no write policy: the gate is the UPDATE on success_measures that fired it.';

revoke all on function public.record_measure_target() from public;
revoke all on function public.record_measure_target() from anon;
revoke all on function public.record_measure_target() from authenticated;
revoke all on function public.record_measure_target() from service_role;

drop trigger if exists success_measures_target_history on public.success_measures;
create trigger success_measures_target_history
after insert or update on public.success_measures
for each row execute function public.record_measure_target();

-- ---- 6. Backfill ----------------------------------------------
--
-- No history exists, so the only honest claim available is that each
-- current target has always applied. That is exactly what the app
-- does today, which is the point: nothing is re-judged by this
-- migration, and real history starts from the next edit.
--
-- effective_from is the measure's creation Friday, EXCEPT where an
-- entry predates it. An entry earlier than its measure's created_at
-- should not be possible, but a backfilled or imported one would be,
-- and a week that falls before the first target row reads as
-- untargeted. Taking the earlier of the two means no week that is
-- judged today becomes unjudged tomorrow.
insert into public.success_measure_targets
  (measure_id, target, value_type, target_direction, effective_from, created_by)
select
  m.id,
  m.target,
  m.value_type,
  m.target_direction,
  least(
    public.friday_of(m.created_at::date),
    coalesce(
      (select min(e.week_ending)
         from public.success_measure_entries e
        where e.measure_id = m.id),
      'infinity'::date
    )
  ),
  null
from public.success_measures m
where btrim(coalesce(m.target, '')) <> ''
on conflict (measure_id, effective_from) do nothing;
