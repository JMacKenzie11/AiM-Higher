-- Benson Seafood's "Pounds Processed": a target of 200,000, for the
-- week beginning 28 September 2026 and from now on.
--
-- A ONE-OFF, like the Promise One promotion before it: one measure,
-- one mistake, no second case.
-- Decision: Jason, 2026-10-06 ("fix it to 200,000 and keep 200,000
-- going forward").
--
-- WHAT HAPPENED. On 2026-10-02 the target was saved while the measure
-- was set to show thousands. The target box takes the measure's unit,
-- so "200,000" was stored as 200,000,000. The week beginning 28 Sep
-- (week_ending 2026-10-02) was judged against that, and 352,399
-- showed red. On 2026-10-06 the measure went back to plain numbers
-- and its target was cleared, which history recorded from the week
-- ending 2026-10-09.
--
-- WHAT THIS DOES, only if the rows are still exactly that:
--   1. the 2026-10-02 history row: 200000000 -> 200000;
--   2. the measure's own target: null -> 200000, which the history
--      trigger (record_measure_target, 0220) writes into the row for
--      the week the migration runs in;
--   3. the 2026-10-09 history row: null -> 200000, set here as well,
--      so "from now on" holds whichever week this runs in.
--
-- ANYWHERE ELSE, NOTHING. A database without Benson, or whose rows
-- no longer read as above (fixed by hand meanwhile, or the dev clone,
-- copied before any of this), gets a notice and no change. A measure
-- id that names something other than Benson's Pounds Processed is the
-- one failure worth stopping on.
do $$
declare
  benson constant uuid := '9ceda2a3-211f-4b00-b50a-67703a1ceb8b';
  measure constant uuid := 'a616cad0-fb7e-4222-99a0-9d1372bf68b9';
  found_desc text;
  found_company uuid;
  found_target text;
  found_scale text;
  row_0102 text;
  row_0102_count int;
  row_0109 text;
  row_0109_count int;
begin
  select m.description, f.company_id, m.target, m.value_scale
    into found_desc, found_company, found_target, found_scale
    from public.success_measures m
    join public.functions f on f.id = m.function_id
   where m.id = measure
   for update of m;

  if found_desc is null then
    raise notice '0264: Benson''s Pounds Processed is not on this database, skipping.';
    return;
  end if;

  if found_desc <> 'Pounds Processed' or found_company is distinct from benson then
    raise exception
      '0264: measure % is "%" in company %, not Pounds Processed at Benson Seafood. Refusing.',
      measure, found_desc, found_company;
  end if;

  select count(*), max(target) into row_0102_count, row_0102
    from public.success_measure_targets
   where measure_id = measure and effective_from = date '2026-10-02';
  select count(*), max(target) into row_0109_count, row_0109
    from public.success_measure_targets
   where measure_id = measure and effective_from = date '2026-10-09';

  if found_target is not null
     or found_scale is distinct from 'plain'
     or row_0102_count <> 1 or row_0102 is distinct from '200000000'
     or row_0109_count <> 1 or row_0109 is not null then
    raise notice
      '0264: Pounds Processed no longer reads as it did on 2026-10-06 (target %, scale %, 2026-10-02 row %, 2026-10-09 row %). Changing nothing.',
      found_target, found_scale, row_0102, row_0109;
    return;
  end if;

  -- 1. The week that was judged against 200,000,000.
  update public.success_measure_targets
     set target = '200000'
   where measure_id = measure and effective_from = date '2026-10-02';

  -- 2. The measure itself. The trigger records it for this week.
  update public.success_measures
     set target = '200000'
   where id = measure;

  -- 3. The week the clearing was recorded for, whatever week this is.
  update public.success_measure_targets
     set target = '200000'
   where measure_id = measure and effective_from = date '2026-10-09';

  -- SELF-VERIFYING, as a data migration has no probe behind it: every
  -- history row from 2026-10-02 on, and the measure, now say 200000.
  if exists (
       select 1 from public.success_measure_targets
        where measure_id = measure
          and effective_from >= date '2026-10-02'
          and target is distinct from '200000')
     or (select target from public.success_measures where id = measure)
          is distinct from '200000' then
    raise exception '0264: Pounds Processed did not end up at 200,000 throughout. Rolled back.';
  end if;

  raise notice '0264: Benson''s Pounds Processed target is 200,000 from the week ending 2026-10-02.';
end $$;
