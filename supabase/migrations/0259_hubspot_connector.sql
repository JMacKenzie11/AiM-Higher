-- =============================================================
-- Migration 0259: HubSpot joins the connector contract
--
-- Phase 4 of the external connections plan. A mapping may now name the
-- 'hubspot' connector, with a HubSpot recipe, and a pull may record
-- 'hubspot' as where its value came from. Nothing else about the
-- contract (0258) changes: who may pull, manual wins, the scheduled
-- path replacing only its own earlier pull, the company from the measure.
--
-- A HubSpot recipe, checked here as the app's parseMapping checks it:
--
--   weekly    {pipeline_id, measure: sum_amount | count,
--              date: created | entered_stage, stage_id (when entered_stage)}
--   snapshot  {pipeline_id, parts: [ {stage_ids: [..], value: amount |
--              weighted_amount}, ... ]}, one to four parts, each with at
--              least one stage
--
-- plus optional pipeline_label and stage_labels, the names when mapped,
-- for the description only. Ids are HubSpot's, which survive a rename;
-- a stage that no longer exists fails the pull in the app, never reads
-- as zero.
--
-- The secret itself is the company's HubSpot service key in the vault
-- (0257), saved on the Connections page after HubSpot accepted it.
-- =============================================================

-- Whether a snapshot recipe's parts are well formed. Immutable, so a
-- CHECK may call it.
create or replace function public.hubspot_snapshot_parts_valid(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p is null or jsonb_typeof(p) <> 'array' then false
    when jsonb_array_length(p) not between 1 and 4 then false
    else not exists (
      select 1
        from jsonb_array_elements(p) as part
       where jsonb_typeof(part) <> 'object'
          or coalesce(part ->> 'value', '') not in ('amount', 'weighted_amount')
          or jsonb_typeof(part -> 'stage_ids') is distinct from 'array'
          or jsonb_array_length(case when jsonb_typeof(part -> 'stage_ids') = 'array' then part -> 'stage_ids' else '[]'::jsonb end) = 0
          or exists (
               select 1
                 from jsonb_array_elements(case when jsonb_typeof(part -> 'stage_ids') = 'array' then part -> 'stage_ids' else '[]'::jsonb end) as stage
                where jsonb_typeof(stage) <> 'string'
             )
    )
  end
$$;

alter table public.success_measures
  drop constraint if exists success_measures_external_source_shape;
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
        and external_source ->> 'connector' in ('google_sheet', 'hubspot')
        and external_source ->> 'kind' in ('weekly', 'snapshot')
        and (
          external_source -> 'pull_day' is null
          or external_source ->> 'pull_day' in ('mon','tue','wed','thu','fri','sat','sun')
        )
        and jsonb_typeof(external_source -> 'recipe') = 'object'
        -- A HubSpot recipe (0259).
        and (
          external_source ->> 'connector' <> 'hubspot'
          or (
            jsonb_typeof(external_source #> '{recipe,pipeline_id}') = 'string'
            and (
              (
                external_source ->> 'kind' = 'weekly'
                and external_source #>> '{recipe,measure}' in ('sum_amount', 'count')
                and external_source #>> '{recipe,date}' in ('created', 'entered_stage')
                and (
                  external_source #>> '{recipe,date}' <> 'entered_stage'
                  or jsonb_typeof(external_source #> '{recipe,stage_id}') = 'string'
                )
              )
              or (
                external_source ->> 'kind' = 'snapshot'
                and public.hubspot_snapshot_parts_valid(external_source #> '{recipe,parts}')
              )
            )
          )
        )
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


alter table public.success_measure_entries
  drop constraint if exists success_measure_entries_origin_pair;
alter table public.success_measure_entries
  add constraint success_measure_entries_origin_pair check (
    (origin is null and pulled_at is null)
    or (origin in ('google_sheet', 'hubspot') and pulled_at is not null)
  );

alter table public.external_pull_log
  drop constraint if exists external_pull_log_connector_check;
alter table public.external_pull_log
  add constraint external_pull_log_connector_check check (connector in ('google_sheet', 'hubspot'));

-- The inner record function, as 0258 left it, with 'hubspot' known.
-- Same signature, so its grants (granted to nobody) and both wrappers
-- stand unchanged.
-- Granted to nobody; the two wrappers below decide who may call it.
create or replace function public._record_external_pull(
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
  if p_connector not in ('google_sheet', 'hubspot') then
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
