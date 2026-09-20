-- =============================================================
-- Migration 0220: the target history has to carry the scale too
--
-- 0219 added value_scale to success_measures AND to
-- success_measure_targets, for a reason it stated: a target of 18
-- means eighteen or eighteen million depending on the scale, and a
-- past week has to keep the reading it was judged under.
--
-- It then left the trigger that WRITES those rows unchanged, so the
-- column it had just added was never populated by the only thing
-- that populates that table. record_measure_target() inserts
-- (measure_id, target, value_type, target_direction, effective_from,
-- created_by) and value_scale falls to its default, 'plain'.
--
-- ---- WHAT THAT COSTS ------------------------------------------
--
-- Everything 0219 was for. Take a measure set to Millions with a
-- target of 18, stored canonically as 18000000. Change the target,
-- and the history row written says scale 'plain'. Every week judged
-- against that row then reads 18000000 as eighteen million against a
-- target of eighteen — off by a factor of a million, every cell red,
-- and nothing anywhere saying why.
--
-- It is the precise failure 0219 exists to prevent, reintroduced one
-- table along. Found while converting three measures by hand and
-- watching what the trigger wrote.
--
-- ---- NO BACKFILL IS NEEDED ------------------------------------
--
-- Every success_measure_targets row on every instance currently says
-- 'plain', and every measure currently says 'plain', so they already
-- agree. The rows are correct today and this only keeps them correct
-- once somebody sets a scale.
--
-- The `on conflict` branch gets it too: two edits in one week take
-- that path, and a scale change is exactly the kind of edit somebody
-- makes twice while getting it right.
-- =============================================================

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
  --
  -- value_scale JOINS that list, because it changes how a week reads
  -- as surely as the target does: the same 18000000 is eighteen
  -- million or eighteen thousand depending on it.
  if tg_op = 'UPDATE'
     and new.target is not distinct from old.target
     and new.value_type is not distinct from old.value_type
     and new.value_scale is not distinct from old.value_scale
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
    (measure_id, target, value_type, value_scale, target_direction,
     effective_from, created_by)
  values (
    new.id,
    -- Blank and null are the same statement: there is no target now.
    case when btrim(coalesce(new.target, '')) = '' then null else new.target end,
    new.value_type,
    new.value_scale,
    new.target_direction,
    v_effective,
    auth.uid()
  )
  on conflict (measure_id, effective_from) do update
    set target           = excluded.target,
        value_type       = excluded.value_type,
        value_scale      = excluded.value_scale,
        target_direction = excluded.target_direction,
        created_by       = excluded.created_by,
        created_at       = now();

  return new;
end;
$$;

revoke all on function public.record_measure_target() from public;
revoke all on function public.record_measure_target() from anon;
revoke all on function public.record_measure_target() from authenticated;
revoke all on function public.record_measure_target() from service_role;

comment on function public.record_measure_target() is
  'Writes the target history row for a measure whose target, value_type, value_scale or target_direction just changed. Runs as the definer so this table needs no write policy: the gate is the UPDATE on success_measures that fired it. value_scale is carried because a target of 18 means eighteen or eighteen million depending on it, and a past week has to keep the reading it was judged under.';
