-- =============================================================
-- Migration 0213: external measures — phase 2, the scheduler
--
-- Phase 1's pull runs as the signed-in caller. A cron has no caller,
-- and 0212 said in as many words that phase 2 "has to come back to a
-- migration to get one, which is the point". This is that migration.
--
-- ---- WHAT 0212 GOT WRONG, MEASURED ---------------------------
--
-- 0212's comments claimed the INSERT policy on external_pull_log was
-- a second wall holding record_external_pull() to the same rule as
-- everybody else. It is not, and the correction is already in that
-- file's text. Measured on the clone while designing this:
--
--   postgres carries rolbypassrls, external_pull_log is owned by
--   postgres, and BYPASSRLS beats FORCE ROW LEVEL SECURITY. A
--   definer function owned by postgres with no auth.uid() guard at
--   all inserted a row with no JWT present.
--
-- That matters here twice. It is why the scheduled path below needs
-- no policy change to work. And it is why the checks INSIDE these
-- functions are the whole wall rather than half of it, which is the
-- reason they are written once and shared rather than twice and
-- hopefully kept in step.
--
-- ---- THE SEAM -------------------------------------------------
--
-- Three functions where there was one:
--
--   _record_external_pull(..., p_actor, p_overwrite_pulled)
--       Everything that decides anything. Granted to NOBODY.
--
--   record_external_pull(...)             → authenticated
--       Requires auth.uid(), checks the caller against the measure's
--       company, delegates with p_actor = auth.uid().
--
--   record_external_pull_scheduled(...)   → service_role
--       No caller to check. Delegates with p_actor = NULL.
--
-- MANUAL-WINS AND THE E4 NO-WRITE RULES LIVE IN THE INNER FUNCTION,
-- so neither wrapper can skip them and a third wrapper written later
-- cannot either. The brief asked for exactly this and it is worth
-- saying why it is structural rather than conventional: the rule
-- that a machine never overwrites a person's number is not a policy
-- anyone can see from the outside, so the only way to keep it is to
-- leave no path around it.
--
-- ---- WHAT THE SERVICE KEY CAN NOW DO, AND WHAT IT STILL CANNOT --
--
-- Granting EXECUTE on the scheduled wrapper to service_role is a
-- real widening and should be read as one: any code holding the
-- service key can now write a pull receipt. Stated plainly rather
-- than buried, because phase 1's claim was narrower.
--
-- What survives the widening, and is probed:
--   * The company is still resolved from the measure. No caller can
--     write a receipt into another tenant's log.
--   * Manual-wins still holds. The scheduled path cannot overwrite a
--     typed value, and unlike the manual path it cannot overwrite a
--     previously PULLED value either (see p_overwrite_pulled).
--   * The actor cannot be forged. The scheduled path has no actor
--     parameter and always writes NULL.
--
-- What is given up: "only a person's session can write a receipt".
-- A scheduler cannot have a session. That is the trade phase 2 is.
--
-- ---- entered_by BECOMES NULLABLE ------------------------------
--
-- success_measure_entries.entered_by was NOT NULL. A cron-written
-- entry has no author and inventing one — a service account, the
-- company's first admin, the measure's lead — would put a person's
-- name on a number they did not enter and may not agree with.
--
-- NULL is the truthful answer, and the column that answers "where
-- did this come from" already exists: origin, plus the receipt in
-- external_pull_log. TypeScript has declared this column
-- `string | null` since before 0212, so the app already reads it
-- that way; this makes the database agree. The one script that
-- attributes entries (seed-meridian-measures) already skips rows it
-- cannot attribute and is unaffected.
--
-- ---- pull_day --------------------------------------------------
--
-- Optional, on the mapping. Sources that refresh later than the
-- rhythm's standard day say so here rather than being pulled early
-- and recorded stale. Absent means Saturday, which is the standard
-- day and is chosen in the cron rather than here.
--
-- The target week is the same whichever day the pass runs: the most
-- recently completed week, which is lastFriday() in the company's
-- timezone and is a stable answer from Saturday through the
-- following Friday. So a Monday pull_day fills the same week a
-- Saturday one would have, later.
-- =============================================================

-- ---- entered_by: a machine-written entry has no author ---------

alter table public.success_measure_entries
  alter column entered_by drop not null;

comment on column public.success_measure_entries.entered_by is
  'Who typed it. NULL when nobody did: the scheduled pull writes entries with no actor, because inventing one would put a person''s name on a number they did not enter. Read origin and external_pull_log to find out where a NULL-actor value came from.';

-- ---- pull_day on the mapping -----------------------------------

alter table public.success_measures
  drop constraint if exists success_measures_external_source_shape;
alter table public.success_measures
  add constraint success_measures_external_source_shape check (
    external_source is null
    -- coalesce is load-bearing. `->` returns SQL NULL for an absent
    -- key, jsonb_typeof(NULL) is NULL, and a CHECK whose expression
    -- is NULL PASSES — so the straightforward spelling accepts every
    -- mapping missing a field, which is the set it exists to reject.
    or coalesce(
      (
        jsonb_typeof(external_source) = 'object'
        and jsonb_typeof(external_source -> 'file_id') = 'string'
        and jsonb_typeof(external_source -> 'tab') = 'string'
        -- New in 0213. Optional; when present it must be a day this
        -- scheduler recognises, so a typo is refused at write time
        -- rather than silently meaning "never".
        and (
          external_source -> 'pull_day' is null
          or external_source ->> 'pull_day' in
             ('mon','tue','wed','thu','fri','sat','sun')
        )
        and (
          (
            external_source ->> 'kind' = 'week_keyed'
            and jsonb_typeof(external_source -> 'key_column') = 'string'
            and jsonb_typeof(external_source -> 'value_column') = 'string'
          )
          or (
            external_source ->> 'kind' = 'snapshot'
            and jsonb_typeof(external_source -> 'cell') = 'string'
            and (
              external_source -> 'freshness' is null
              or (
                jsonb_typeof(external_source -> 'freshness') = 'object'
                and jsonb_typeof(external_source #> '{freshness,tab}') = 'string'
                and jsonb_typeof(external_source #> '{freshness,cell}') = 'string'
              )
            )
          )
        )
      ),
      false
    )
  );

-- ---- A fifth outcome -------------------------------------------
--
-- 'skipped_exists' is NOT the same as 'skipped_manual_exists' and
-- collapsing them would lose the only interesting distinction in a
-- re-run: "a person had already answered this" versus "we had
-- already answered it ourselves". The first is a fact about the
-- team. The second is the scheduler being idempotent.
alter table public.external_pull_log
  drop constraint if exists external_pull_log_outcome_check;
alter table public.external_pull_log
  add constraint external_pull_log_outcome_check check (
    outcome in (
      'written',
      'skipped_manual_exists',
      'skipped_exists',
      'skipped_stale',
      'failed'
    )
  );

-- ---- The inner writer, granted to nobody -----------------------

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
  -- FALSE for the scheduler: a re-run of the same week must write
  -- nothing, which is what makes a double fire, a retry and a manual
  -- re-trigger all safe. A typed value is protected from BOTH.
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
    select true, e.origin
      into v_entry_exists, v_existing_origin
      from public.success_measure_entries e
     where e.measure_id = p_measure_id
       and e.week_ending = p_week_ending;

    if coalesce(v_entry_exists, false) and v_existing_origin is null then
      -- A person typed it. Nothing replaces that, from any path.
      v_outcome := 'skipped_manual_exists';
    elsif coalesce(v_entry_exists, false) and not p_overwrite_pulled then
      -- We wrote it ourselves already. Idempotence, for the
      -- scheduler: a second run of the same week changes nothing.
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

-- Granted to NOBODY. Reachable only from the two wrappers below,
-- which run as the owner. A future third caller has to be added here
-- deliberately rather than by importing a client.
revoke all on function public._record_external_pull(uuid, date, text, text, numeric, text, jsonb, uuid, boolean) from public;
revoke all on function public._record_external_pull(uuid, date, text, text, numeric, text, jsonb, uuid, boolean) from anon;
revoke all on function public._record_external_pull(uuid, date, text, text, numeric, text, jsonb, uuid, boolean) from authenticated;
revoke all on function public._record_external_pull(uuid, date, text, text, numeric, text, jsonb, uuid, boolean) from service_role;

comment on function public._record_external_pull(uuid, date, text, text, numeric, text, jsonb, uuid, boolean) is
  'Everything a pull decides once written down once. Resolves the company from the measure, enforces manual-wins, enforces the scheduler''s idempotence, writes the entry and the receipt. Granted to nobody: the two wrappers reach it as the owner, and a third path has to be added here rather than around it.';

-- ---- The caller's path, unchanged in signature -----------------

create or replace function public.record_external_pull(
  p_measure_id uuid,
  p_week_ending date,
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
    or public.is_guide_for(v_company)
  ) then
    raise exception 'record_external_pull: not permitted for this company'
      using errcode = '42501';
  end if;

  -- A person pressing Pull now is asking for a fresh read, so a
  -- value this feature wrote earlier may be replaced. A value a
  -- person typed may not, and that is decided inside.
  return query select * from public._record_external_pull(
    p_measure_id, p_week_ending, p_mapping_kind, p_outcome,
    p_value, p_failure_reason, p_detail, v_uid, true
  );
end;
$$;

revoke all on function public.record_external_pull(uuid, date, text, text, numeric, text, jsonb) from public;
revoke all on function public.record_external_pull(uuid, date, text, text, numeric, text, jsonb) from anon;
revoke all on function public.record_external_pull(uuid, date, text, text, numeric, text, jsonb) from service_role;
grant execute on function public.record_external_pull(uuid, date, text, text, numeric, text, jsonb) to authenticated;

-- ---- The scheduler's path --------------------------------------

create or replace function public.record_external_pull_scheduled(
  p_measure_id uuid,
  p_week_ending date,
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
  -- NO ROLE CHECK, because there is no role to check: this path has
  -- no caller identity by construction. What replaces it is the
  -- grant — service_role and nobody else — and everything the inner
  -- function enforces regardless of who is asking.
  --
  -- NO ACTOR PARAMETER either. The actor is NULL, always, and cannot
  -- be passed. A scheduled entry says "nobody typed this" and means
  -- it.
  --
  -- p_overwrite_pulled is FALSE: a second run of the same week
  -- writes nothing and logs skipped_exists. That is what makes a
  -- double cron fire, an app-level retry and a hand re-trigger all
  -- safe, without the caller having to check first.
  return query select * from public._record_external_pull(
    p_measure_id, p_week_ending, p_mapping_kind, p_outcome,
    p_value, p_failure_reason, p_detail, null::uuid, false
  );
end;
$$;

revoke all on function public.record_external_pull_scheduled(uuid, date, text, text, numeric, text, jsonb) from public;
revoke all on function public.record_external_pull_scheduled(uuid, date, text, text, numeric, text, jsonb) from anon;
-- NOT to authenticated. A browser client must never reach the path
-- that skips the role check, and the probe for this asserts 42501
-- rather than assuming the absence of a grant.
revoke all on function public.record_external_pull_scheduled(uuid, date, text, text, numeric, text, jsonb) from authenticated;
grant execute on function public.record_external_pull_scheduled(uuid, date, text, text, numeric, text, jsonb) to service_role;

comment on function public.record_external_pull_scheduled(uuid, date, text, text, numeric, text, jsonb) is
  'The scheduler''s write path. service_role only, never authenticated. Writes entries with a NULL actor and refuses to replace ANY existing entry for the week, typed or previously pulled, which is what makes the weekly cron idempotent. Everything else is the same code the caller''s path runs.';
