-- =============================================================
-- Migration 0258: the connector contract, with Google Sheets moved onto it
--
-- Phase 2 of the external connections plan
-- (docs/plans/external-connections.md, section 2).
--
-- Until now a mapping described where a number sits in a SHEET:
-- "week_keyed" (a row per week) or "snapshot" (one cell), with the
-- sheet's fields at the top level, and 'google_sheet' was written as a
-- literal inside the record function. A HubSpot number sits nowhere; it
-- is a sum or a count over deals. So every mapping now has the same four
-- parts, whatever it connects to:
--
--   connector  "google_sheet" (HubSpot joins in phase 4)
--   kind       what time the number describes:
--                "weekly"    a value for a given week; can be backfilled
--                "snapshot"  the value as it stands; cannot
--   pull_day   optional, as before
--   recipe     the connector's own instructions: for a sheet, the file,
--              tab and headings ("weekly") or cell ("snapshot")
--
-- ---- 1. Every mapping, translated in place --------------------------
--
-- week_keyed {file_id, tab, key_column, value_column, pull_day?}
--   becomes {connector: google_sheet, kind: weekly, pull_day?, recipe:
--   {file_id, tab, key_column, value_column}}; snapshot likewise, with
--   cell and freshness in the recipe. Counted by kind before and after,
--   and the migration stops if the counts differ. The shape check is
--   rewritten for the new form.
--
-- ---- 2. The receipts -------------------------------------------------
--
-- external_pull_log gains connector (every existing row is a sheet
-- pull). mapping_kind 'week_keyed' becomes 'weekly', in the column and
-- in each receipt's detail, so old and new receipts read the same way.
--
-- ---- 3. The record functions name the connector -----------------------
--
-- record_external_pull and record_external_pull_scheduled take
-- p_connector, after the week. The entry's origin and the receipt's
-- connector are what the caller read from, which the caller knows even
-- if the mapping changed while the pull ran. A connector the database
-- does not know is refused. Everything else is exactly as 0213, 0245
-- and 0248 left it: who may call each, manual wins, the scheduled path
-- replacing only its own earlier pull when the source changed, and the
-- company resolved from the measure.
--
-- ---- Rolling out --------------------------------------------------------
--
-- The new code and this migration each read only the other's shape, so
-- they go out together: the fleet run, then the merge straight after.
-- Every mapped measure pulls on Saturday, so the scheduler is never in
-- the gap on a weekday; a "Pull now" pressed in it fails visibly, with
-- a receipt, and can be pressed again a minute later.
-- =============================================================

-- ---- 1. Mappings ----------------------------------------------------

alter table public.success_measures
  drop constraint if exists success_measures_external_source_shape;

do $$
declare
  v_weekly_before int;
  v_snapshot_before int;
  v_weekly_after int;
  v_snapshot_after int;
begin
  select count(*) filter (where external_source ->> 'kind' = 'week_keyed'),
         count(*) filter (where external_source ->> 'kind' = 'snapshot')
    into v_weekly_before, v_snapshot_before
    from public.success_measures
   where external_source is not null;

  update public.success_measures
     set external_source = jsonb_strip_nulls(
           case external_source ->> 'kind'
             when 'week_keyed' then jsonb_build_object(
               'connector', 'google_sheet',
               'kind', 'weekly',
               'pull_day', external_source -> 'pull_day',
               'recipe', jsonb_build_object(
                 'file_id', external_source -> 'file_id',
                 'tab', external_source -> 'tab',
                 'key_column', external_source -> 'key_column',
                 'value_column', external_source -> 'value_column'))
             else jsonb_build_object(
               'connector', 'google_sheet',
               'kind', 'snapshot',
               'pull_day', external_source -> 'pull_day',
               'recipe', jsonb_build_object(
                 'file_id', external_source -> 'file_id',
                 'tab', external_source -> 'tab',
                 'cell', external_source -> 'cell',
                 'freshness', external_source -> 'freshness'))
           end)
   where external_source is not null
     and external_source ->> 'kind' in ('week_keyed', 'snapshot')
     and external_source -> 'connector' is null;

  select count(*) filter (where external_source ->> 'kind' = 'weekly'),
         count(*) filter (where external_source ->> 'kind' = 'snapshot')
    into v_weekly_after, v_snapshot_after
    from public.success_measures
   where external_source is not null;

  if v_weekly_after <> v_weekly_before or v_snapshot_after <> v_snapshot_before then
    raise exception '0258: mappings before (% week_keyed, % snapshot) and after (% weekly, % snapshot) do not match',
      v_weekly_before, v_snapshot_before, v_weekly_after, v_snapshot_after;
  end if;
  raise notice '0258: translated % weekly and % snapshot mapping(s)', v_weekly_after, v_snapshot_after;
end $$;

alter table public.success_measures
  add constraint success_measures_external_source_shape check (
    external_source is null
    -- coalesce is load-bearing, as in 0213: a CHECK whose expression is
    -- NULL passes, and `->` on an absent key is NULL.
    or coalesce(
      (
        jsonb_typeof(external_source) = 'object'
        -- The four parts and nothing else, so a field nothing reads
        -- cannot ride along looking like configuration.
        and (external_source - array['connector', 'kind', 'pull_day', 'recipe']) = '{}'::jsonb
        and external_source ->> 'connector' in ('google_sheet')
        and external_source ->> 'kind' in ('weekly', 'snapshot')
        and (
          external_source -> 'pull_day' is null
          or external_source ->> 'pull_day' in ('mon','tue','wed','thu','fri','sat','sun')
        )
        and jsonb_typeof(external_source -> 'recipe') = 'object'
        -- A sheet's recipe.
        and (
          external_source ->> 'connector' <> 'google_sheet'
          or (
            jsonb_typeof(external_source #> '{recipe,file_id}') = 'string'
            and jsonb_typeof(external_source #> '{recipe,tab}') = 'string'
            and (
              (
                external_source ->> 'kind' = 'weekly'
                and jsonb_typeof(external_source #> '{recipe,key_column}') = 'string'
                and jsonb_typeof(external_source #> '{recipe,value_column}') = 'string'
              )
              or (
                external_source ->> 'kind' = 'snapshot'
                and jsonb_typeof(external_source #> '{recipe,cell}') = 'string'
                and (
                  external_source #> '{recipe,freshness}' is null
                  or (
                    jsonb_typeof(external_source #> '{recipe,freshness}') = 'object'
                    and jsonb_typeof(external_source #> '{recipe,freshness,tab}') = 'string'
                    and jsonb_typeof(external_source #> '{recipe,freshness,cell}') = 'string'
                  )
                )
              )
            )
          )
        )
      ),
      false
    )
  );

-- The connectors an entry can have come from. Phase 4 adds 'hubspot'.
alter table public.success_measure_entries
  drop constraint if exists success_measure_entries_origin_pair;
alter table public.success_measure_entries
  add constraint success_measure_entries_origin_pair check (
    (origin is null and pulled_at is null)
    or (origin in ('google_sheet') and pulled_at is not null)
  );

-- ---- 2. Receipts ------------------------------------------------------

alter table public.external_pull_log add column if not exists connector text;
update public.external_pull_log set connector = 'google_sheet' where connector is null;
alter table public.external_pull_log alter column connector set not null;
alter table public.external_pull_log
  drop constraint if exists external_pull_log_connector_check;
alter table public.external_pull_log
  add constraint external_pull_log_connector_check check (connector in ('google_sheet'));

alter table public.external_pull_log
  drop constraint if exists external_pull_log_mapping_kind_check;
update public.external_pull_log
   set mapping_kind = 'weekly',
       detail = case when detail ->> 'kind' = 'week_keyed'
                     then jsonb_set(detail, '{kind}', '"weekly"')
                     else detail end
 where mapping_kind = 'week_keyed';
alter table public.external_pull_log
  add constraint external_pull_log_mapping_kind_check check (mapping_kind in ('weekly', 'snapshot'));

-- ---- 3. The record functions --------------------------------------------

drop function if exists public.record_external_pull(uuid, date, text, text, numeric, text, jsonb);
drop function if exists public.record_external_pull_scheduled(uuid, date, text, text, numeric, text, jsonb);
drop function if exists public._record_external_pull(uuid, date, text, text, numeric, text, jsonb, uuid, boolean);

-- Granted to nobody; the two wrappers below decide who may call it.
create function public._record_external_pull(
  p_measure_id uuid,
  p_week_ending date,
  p_connector text,
  p_mapping_kind text,
  p_outcome text,
  p_value numeric,
  p_failure_reason text,
  p_detail jsonb,
  p_actor uuid,
  -- TRUE for a person pressing Pull now: an earlier pull may be
  -- replaced. FALSE for the scheduler: it replaces an earlier pull only
  -- when the source now says something different (0248). A typed value
  -- is protected from both.
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
  if p_connector not in ('google_sheet') then
    raise exception '_record_external_pull: unknown connector %', p_connector;
  end if;
  if p_mapping_kind not in ('weekly', 'snapshot') then
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
  -- in any wrapper, so no caller can write a receipt into somebody
  -- else's log.
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
      -- The scheduler wrote it already and the source still says the
      -- same: a re-run changes nothing (0248).
      v_outcome := 'skipped_exists';
    else
      insert into public.success_measure_entries
        (measure_id, week_ending, value_number, value_text, entered_by,
         origin, pulled_at)
      values
        (p_measure_id, p_week_ending, p_value, null, p_actor,
         p_connector, now())
      on conflict (measure_id, week_ending) do update
        set value_number = excluded.value_number,
            value_text = null,
            entered_by = excluded.entered_by,
            origin = excluded.origin,
            pulled_at = excluded.pulled_at;
    end if;
  end if;

  insert into public.external_pull_log
    (measure_id, company_id, week_ending, connector, mapping_kind, outcome,
     value_written, failure_reason, detail)
  values
    (p_measure_id, v_company, p_week_ending, p_connector, p_mapping_kind, v_outcome,
     case when v_outcome = 'written' then p_value else null end,
     p_failure_reason, coalesce(p_detail, '{}'::jsonb))
  returning id into v_log_id;

  return query select v_outcome, v_log_id;
end;
$$;

-- From every role by name: Supabase grants EXECUTE on a new function to
-- anon, authenticated and service_role by default, and revoking from
-- PUBLIC alone leaves those grants in place.
revoke all on function public._record_external_pull(uuid, date, text, text, text, numeric, text, jsonb, uuid, boolean)
  from public, anon, authenticated, service_role;

-- Write: system_admin, the company's company_admin, is_content_admin_for
-- (an assigned guide, or a switched-on portfolio admin), as 0245.
create function public.record_external_pull(
  p_measure_id uuid,
  p_week_ending date,
  p_connector text,
  p_mapping_kind text,
  p_outcome text,
  p_value numeric default null,
  p_failure_reason text default null,
  p_detail jsonb default '{}'::jsonb
)
returns table (outcome text, log_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_company uuid;
begin
  if v_uid is null then
    raise exception 'record_external_pull requires an authenticated caller';
  end if;

  select f.company_id into v_company
  from public.success_measures m
  join public.functions f on f.id = m.function_id
  where m.id = p_measure_id;

  if v_company is null then
    raise exception 'record_external_pull: no such measure, or it belongs to no function';
  end if;

  if not (
    public.auth_role() = 'system_admin'
    or (
      public.auth_role() = 'company_admin'
      and public.auth_company_id() = v_company
    )
    or public.is_content_admin_for(v_company)
  ) then
    raise exception 'record_external_pull: not permitted for this company'
      using errcode = '42501';
  end if;

  -- A person pressing Pull now is asking for a fresh read, so a value
  -- this feature wrote earlier may be replaced. A value a person typed
  -- may not, and that is decided inside.
  return query select * from public._record_external_pull(
    p_measure_id, p_week_ending, p_connector, p_mapping_kind, p_outcome,
    p_value, p_failure_reason, p_detail, v_uid, true
  );
end;
$$;

revoke all on function public.record_external_pull(uuid, date, text, text, text, numeric, text, jsonb)
  from public, anon, service_role;
grant execute on function public.record_external_pull(uuid, date, text, text, text, numeric, text, jsonb) to authenticated;

-- Write: service_role only (the scheduler). No caller identity, so no
-- role check and no actor: a scheduled entry says nobody typed it.
create function public.record_external_pull_scheduled(
  p_measure_id uuid,
  p_week_ending date,
  p_connector text,
  p_mapping_kind text,
  p_outcome text,
  p_value numeric default null,
  p_failure_reason text default null,
  p_detail jsonb default '{}'::jsonb
)
returns table (outcome text, log_id uuid)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query select * from public._record_external_pull(
    p_measure_id, p_week_ending, p_connector, p_mapping_kind, p_outcome,
    p_value, p_failure_reason, p_detail, null::uuid, false
  );
end;
$$;

revoke all on function public.record_external_pull_scheduled(uuid, date, text, text, text, numeric, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_external_pull_scheduled(uuid, date, text, text, text, numeric, text, jsonb) to service_role;

comment on function public.record_external_pull_scheduled(uuid, date, text, text, text, numeric, text, jsonb) is
  'The scheduler''s write path. service_role only, never authenticated. Writes entries with a NULL actor. Never replaces a typed value; replaces its own earlier pull only when the source''s number has changed (0248), so a re-run that reads the same number writes nothing. Names the connector it read from (0258).';
