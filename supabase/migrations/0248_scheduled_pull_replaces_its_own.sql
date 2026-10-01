-- 0248: the scheduled sheet pull replaces its own earlier pull when the
-- sheet's number has changed.
--
-- Until now the scheduler never replaced ANY existing entry for the week.
-- That protected typed values, and made a re-run harmless, but it also
-- froze a part-week number: "Pull now" in the middle of a week writes
-- the running total, and the scheduled pull after the week closes then
-- skipped the real total because the week "was already recorded".
-- Found in production on 2026-10-01 (Benson, Total Pounds Received,
-- week ending 2026-09-25: 95,894 kept, 152,727 skipped).
--
-- Now, on the scheduled path only:
--   a typed value          never replaced (skipped_manual_exists), as before
--   a pulled value, same   nothing written (skipped_exists), as before
--   a pulled value, changed  replaced (written)
-- The caller path ("Pull now") is unchanged: it already replaced its own
-- earlier pulls.
--
-- Only the inner function changes; both wrappers, their grants and their
-- signatures are as 0213 and 0245 left them.

create or replace function public._record_external_pull(
  p_measure_id uuid,
  p_week_ending date,
  p_mapping_kind text,
  p_outcome text,
  p_value numeric,
  p_failure_reason text,
  p_detail jsonb,
  p_actor uuid,
  -- Whether an entry this feature wrote earlier may be replaced.
  --
  -- TRUE for a person pressing Pull now: they are asking for a fresh
  -- read and expect the number to move.
  -- FALSE for the scheduler: it replaces an earlier pull only when the
  -- sheet now says something different (0248), so a re-run that reads
  -- the same number still writes nothing, which is what keeps a double
  -- fire, a retry and a manual re-trigger safe. A typed value is
  -- protected from BOTH.
  p_overwrite_pulled boolean
)
returns table (outcome text, log_id uuid)
language plpgsql
set search_path = public
as $$
declare
  v_company uuid;
  v_outcome text := p_outcome;
  v_existing_origin text;
  v_existing_value numeric;
  v_entry_exists boolean;
  v_log_id uuid;
begin
  if p_mapping_kind not in ('week_keyed', 'snapshot') then
    raise exception '_record_external_pull: unknown mapping kind %', p_mapping_kind;
  end if;
  if p_outcome not in ('written', 'skipped_manual_exists', 'skipped_exists', 'skipped_stale', 'failed') then
    raise exception '_record_external_pull: unknown outcome %', p_outcome;
  end if;
  if p_outcome = 'written' and p_value is null then
    raise exception '_record_external_pull: a written outcome needs a value';
  end if;
  if p_outcome = 'failed' and p_failure_reason is null then
    raise exception '_record_external_pull: a failed outcome needs a reason';
  end if;

  -- The company comes from the measure. There is no parameter for it
  -- in any wrapper, so there is no argument any caller can pass to
  -- write a receipt into somebody else's log.
  select f.company_id into v_company
  from public.success_measures m
  join public.functions f on f.id = m.function_id
  where m.id = p_measure_id;

  if v_company is null then
    raise exception '_record_external_pull: no such measure, or it belongs to no function';
  end if;

  if v_outcome = 'written' then
    select true, e.origin, e.value_number
      into v_entry_exists, v_existing_origin, v_existing_value
      from public.success_measure_entries e
     where e.measure_id = p_measure_id
       and e.week_ending = p_week_ending;

    if coalesce(v_entry_exists, false) and v_existing_origin is null then
      -- A person typed it. Nothing replaces that, from any path.
      v_outcome := 'skipped_manual_exists';
    elsif coalesce(v_entry_exists, false) and not p_overwrite_pulled
          and v_existing_value is not distinct from p_value then
      -- We wrote it ourselves already, and the sheet still says the
      -- same. Idempotence, for the scheduler: a re-run changes nothing.
      -- When the sheet says something else, the scheduler falls through
      -- and replaces its own earlier pull: a "Pull now" in the middle of
      -- the week wrote a running total, and the scheduled pull after
      -- the week closes is the one that has the week's number
      -- (Benson's Total Pounds Received, week ending 2026-09-25:
      -- 95,894 on the Thursday, 152,727 on the Saturday, kept at
      -- 95,894 until this).
      v_outcome := 'skipped_exists';
    else
      insert into public.success_measure_entries
        (measure_id, week_ending, value_number, value_text, entered_by,
         origin, pulled_at)
      values
        (p_measure_id, p_week_ending, p_value, null, p_actor,
         'google_sheet', now())
      on conflict (measure_id, week_ending) do update
        set value_number = excluded.value_number,
            value_text = null,
            entered_by = excluded.entered_by,
            origin = 'google_sheet',
            pulled_at = excluded.pulled_at;
    end if;
  end if;

  insert into public.external_pull_log
    (measure_id, company_id, week_ending, mapping_kind, outcome,
     value_written, failure_reason, detail)
  values
    (p_measure_id, v_company, p_week_ending, p_mapping_kind, v_outcome,
     case when v_outcome = 'written' then p_value else null end,
     p_failure_reason, coalesce(p_detail, '{}'::jsonb))
  returning id into v_log_id;

  return query select v_outcome, v_log_id;
end;
$$;

comment on function public.record_external_pull_scheduled(uuid, date, text, text, numeric, text, jsonb) is
  'The scheduler''s write path. service_role only, never authenticated. Writes entries with a NULL actor. Never replaces a typed value; replaces its own earlier pull only when the sheet''s number has changed (0248), so a re-run that reads the same number writes nothing.';
