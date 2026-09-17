-- =============================================================
-- Migration 0212: external measures — phase 1, the spine
--
-- A Critical Success Factor's weekly value can come from a client's
-- own spreadsheet instead of a person typing it. This migration is
-- the storage and the wall around it. The reader, the action and the
-- surface are application code; what is decided HERE is who may
-- write a value they did not type, what that write is allowed to
-- overwrite, and what record it is obliged to leave.
--
-- PHASE 1 ONLY. No scheduler (phase 2), no HubSpot connector and
-- credential vault (phase 3), no client-facing mapping UI (phase 4).
-- Mapping is configured by a system_admin through a minimal
-- affordance on the measure, and a pull happens because somebody
-- pressed something. That matters to two decisions below — the
-- definer function requires auth.uid(), and service_role is refused
-- INSERT — and both are deliberately the kind of refusal that makes
-- phase 2 come back here and say what it wants.
--
-- ---- WHICH TABLE, AND WHY ------------------------------------
--
-- public.success_measures is the measure-level table /measures
-- reads. Since migration 0166 it holds both levels: a Critical
-- Success Factor is kind='csf', a KPI is kind='kpi', and both carry
-- their own weekly entries. So external_source lands here once and
-- serves both levels rather than being added to a CSF table and
-- wanted on KPIs a week later.
--
-- success_measures has no company_id of its own. It reaches company
-- scope through functions.function_id -> functions.company_id, which
-- is the traversal every policy on it already performs.
--
-- ---- THE MAPPING, AND WHY IT IS jsonb WITH A CHECK -------------
--
-- Two kinds today and a third arriving in phase 3 (HubSpot), whose
-- fields nobody can name yet. Columns would mean a migration per
-- connector and a table of mostly-NULL columns discriminated by a
-- kind column anyway.
--
-- jsonb WITHOUT a constraint would mean the shape lives only in
-- TypeScript, and the first row written by a script or a psql
-- session would be a mapping the reader cannot parse and the pull
-- discovers at run time. So the discriminated union is a CHECK: the
-- database knows the two shapes, and a third has to be added here.
--
-- ---- WHAT A PULLED ENTRY LOOKS LIKE ---------------------------
--
-- origin and pulled_at on success_measure_entries, both NULL for a
-- manual entry. They are constrained to move together: an entry
-- cannot claim an origin without saying when it was pulled, and
-- cannot carry a pull time with no origin. The surface reads origin
-- to decide whether to show the receipt note, and a half-set pair
-- would render a tag pointing at nothing.
--
-- MANUAL ENTRIES MUST CLEAR THEM. The two manual write paths
-- (logMeasureEntriesAction, logMeasureEntryAction) upsert on
-- (measure_id, week_ending), and an upsert only touches the columns
-- in its payload — so a manual edit of a previously-pulled week
-- would have left origin='google_sheet' sitting on a number a person
-- had just typed. Both paths now write NULL to both columns
-- explicitly. This is application code, which is why the constraint
-- below cannot enforce it; what the constraint does enforce is that
-- neither path can leave the pair half-written.
--
-- ---- THE LOG, AND WHY IT CARRIES company_id --------------------
--
-- external_pull_log is the receipt. Every pull writes exactly one
-- row whether it wrote a value or refused to, because the interesting
-- case is the refusal: "the number did not change this week" and
-- "we could not read the sheet" look identical on a chart and must
-- not look identical here.
--
-- company_id is derivable through measure -> function and is stored
-- anyway. Two reasons. It is an AUDIT record of a pull that was made
-- for a company at a moment, and if a measure is later moved to a
-- function in another company the record of who pulled what must not
-- move with it. And it lets the SELECT policy compare a column
-- instead of traversing two joins on every row.
--
-- It is derived, never passed: record_external_pull() has no
-- company parameter. See below.
--
-- ---- THE INSERT MECHANISM, AND E5 ------------------------------
--
-- Failure mode E5: app guards are courtesy, the database is the
-- boundary. The rejected alternative was the obvious one — let the
-- server action insert the log row through the caller's client under
-- an INSERT policy, and trust the action to always write one.
--
-- Rejected because it makes three separate claims into app promises:
-- that the row's company is the measure's company, that a pull only
-- happens for a company the caller may pull for, and that a value
-- written by a pull never silently replaces a number a person typed.
-- Each of those is true of today's action and none of them is true
-- of the database, so the first second caller — phase 2's scheduler,
-- a backfill script, a fix applied by hand at 11pm — is free to
-- violate all three.
--
-- So writes go through public.record_external_pull(), SECURITY
-- DEFINER, and the three claims become database facts:
--
--   1. There is NO company parameter. The company is resolved from
--      the measure inside the function, so no caller can write a
--      receipt into another tenant's log.
--   2. The caller is checked against that resolved company before
--      anything is written. system_admin, company_admin of that
--      company, or an assigned guide (see the role note below).
--   3. MANUAL WINS IS ENFORCED HERE, not in the action. The function
--      reads the existing entry and downgrades its own outcome to
--      'skipped_manual_exists' if a person's entry is already there.
--      This is the only race-free place to make that decision, and
--      it means the rule holds for a caller that has not been
--      written yet.
--
-- The function returns the outcome it ACTUALLY took, which may
-- differ from the one it was asked for. The action reports what came
-- back rather than what it requested.
--
-- This is available because a phase-1 pull always runs inside a
-- request with a session, exactly as the coach-memory write path
-- does (0194). Phase 2's scheduler has no auth.uid() and will need
-- its own path; it has to come back to a migration to get one, which
-- is the point.
--
-- ---- ROLES: WHY aims_guide IS HERE ----------------------------
--
-- The brief names system_admin and company_admin. An aims_guide is
-- company_admin on the companies assigned to them — that equivalence
-- is a platform convention, and every policy admitting company_admin
-- carries a guide mirror through is_guide_for(). Omitting it here
-- would make external measures the one surface where a guide is
-- locked out of a client they otherwise administer, which reads as
-- an oversight rather than a decision. Admitted deliberately, and
-- named here so it is reviewable.
--
-- ---- service_role: SELECT YES, WRITE NO -----------------------
--
-- Unlike coach_memories (0194) this table is not a privacy wall and
-- service_role keeps SELECT: it is operational data and fleet
-- tooling has every reason to read it.
--
-- INSERT, UPDATE and DELETE are revoked. The claim this table makes
-- is INTEGRITY, not secrecy: a pull receipt cannot be forged and
-- cannot be erased. Leaving INSERT with service_role would reduce
-- "the log is written by the pull path" to "the log is written by
-- whatever holds the service key", which is the E5 mistake wearing a
-- grant instead of a source check.
--
-- There are NO UPDATE or DELETE policies for anyone, and the verbs
-- are not granted. Both walls, deliberately: a policy-shaped absence
-- and a privilege-shaped absence look identical from the client (0
-- rows), and only the privilege refuses with an error. E8.
-- =============================================================

-- ---- success_measures.external_source -------------------------

alter table public.success_measures
  add column if not exists external_source jsonb;

-- The discriminated union, as a database fact. Both kinds require a
-- file and a named tab; addressing the tab explicitly is not
-- optional, and the reader has its own note about why.
alter table public.success_measures
  drop constraint if exists success_measures_external_source_shape;
alter table public.success_measures
  add constraint success_measures_external_source_shape check (
    external_source is null
    -- coalesce is load-bearing, not defensive. `->` returns SQL NULL
    -- for a key that is absent, jsonb_typeof(NULL) is NULL, and a
    -- CHECK whose expression evaluates to NULL PASSES. So the
    -- straightforward spelling of this constraint would have
    -- accepted every mapping that was missing a field, which is
    -- precisely the set it exists to reject.
    or coalesce(
      (
      jsonb_typeof(external_source) = 'object'
      and jsonb_typeof(external_source -> 'file_id') = 'string'
      and jsonb_typeof(external_source -> 'tab') = 'string'
      and (
        (
          external_source ->> 'kind' = 'week_keyed'
          and jsonb_typeof(external_source -> 'key_column') = 'string'
          and jsonb_typeof(external_source -> 'value_column') = 'string'
        )
        or (
          external_source ->> 'kind' = 'snapshot'
          and jsonb_typeof(external_source -> 'cell') = 'string'
          -- Freshness is optional. Present, it must be complete:
          -- a freshness field naming a tab but no cell is a mapping
          -- that would silently never decline.
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

comment on column public.success_measures.external_source is
  'Where this measure''s weekly value comes from when it is not typed. NULL for an ordinary measure. Two kinds, checked by constraint: week_keyed {file_id, tab, key_column, value_column} finds the row whose key column matches the target week; snapshot {file_id, tab, cell, freshness?} reads one cell now and records it as the target week, declining when the optional freshness date does not cover that week. Phase 1 is Google Sheets only; the kind discriminator is what a later connector adds itself to.';

-- ---- success_measure_entries: where a value came from ---------

alter table public.success_measure_entries
  add column if not exists origin text;
alter table public.success_measure_entries
  add column if not exists pulled_at timestamptz;

alter table public.success_measure_entries
  drop constraint if exists success_measure_entries_origin_pair;
alter table public.success_measure_entries
  add constraint success_measure_entries_origin_pair check (
    (origin is null and pulled_at is null)
    -- `origin is not null` first, for the reason spelled out on the
    -- mapping constraint above: without it, origin NULL with
    -- pulled_at set evaluates to NULL and a NULL CHECK passes.
    or (
      origin is not null
      and origin = 'google_sheet'
      and pulled_at is not null
    )
  );

comment on column public.success_measure_entries.origin is
  'NULL means a person typed it, which is every entry that existed before 0212 and every manual entry after it. ''google_sheet'' means a pull wrote it and external_pull_log holds the receipt. Constrained to move with pulled_at so a tag can never point at nothing.';

comment on column public.success_measure_entries.pulled_at is
  'When the pull that wrote this value ran. NULL for a manual entry. Not the sheet''s own timestamp — that, where it exists, is the snapshot freshness date and lives in the log''s detail.';

-- ---- external_pull_log ----------------------------------------

create table if not exists public.external_pull_log (
  id uuid primary key default gen_random_uuid(),
  measure_id uuid not null
    references public.success_measures(id) on delete cascade,
  company_id uuid not null
    references public.companies(id) on delete cascade,
  week_ending date not null,
  mapping_kind text not null
    check (mapping_kind in ('week_keyed', 'snapshot')),
  outcome text not null check (
    outcome in (
      'written',
      'skipped_manual_exists',
      'skipped_stale',
      'failed'
    )
  ),
  -- Only set when outcome = 'written'. A value that was read but not
  -- written lives in detail, where it is plainly a thing that was
  -- seen rather than a thing that was recorded.
  value_written numeric,
  failure_reason text,
  -- What was asked and what came back. The receipt's substance:
  -- which file, which tab, which cell or key, the raw text found,
  -- and the freshness date where the mapping had one.
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint external_pull_log_value_only_when_written check (
    (outcome = 'written' and value_written is not null)
    or (outcome <> 'written' and value_written is null)
  ),
  constraint external_pull_log_reason_only_when_not_ok check (
    outcome <> 'failed' or failure_reason is not null
  )
);

comment on table public.external_pull_log is
  'One row per pull, successful or not. The refusals are the point: a week with no entry because the sheet was unreachable and a week with no entry because nobody looked are indistinguishable on a chart and must not be indistinguishable here. Append-only by construction — no UPDATE or DELETE policy exists and neither verb is granted to anyone. Written only through record_external_pull().';

comment on column public.external_pull_log.company_id is
  'Derived inside record_external_pull() from the measure''s function, never passed by a caller. Stored rather than traversed so this stays a record of a pull made for a company at a moment, even if the measure later moves.';

create index if not exists external_pull_log_measure_week_idx
  on public.external_pull_log (measure_id, week_ending desc);

create index if not exists external_pull_log_company_created_idx
  on public.external_pull_log (company_id, created_at desc);

alter table public.external_pull_log enable row level security;
-- FORCE so a future owner-role path is inside the rules too.
--
-- IT DOES NOT CONSTRAIN THE DEFINER FUNCTION BELOW, and an earlier
-- draft of this comment claimed it did. Measured on the clone before
-- phase 2 was designed: `postgres` carries rolbypassrls, this table
-- is owned by postgres, and BYPASSRLS beats FORCE. A definer function
-- owned by postgres with no auth.uid() guard at all inserted a row
-- here with no JWT present.
--
-- So the wall around this table is NOT policy-plus-privilege. It is:
--
--   * authenticated holds no INSERT privilege, so no browser client
--     can write a row (probed: 42501);
--   * service_role holds no INSERT privilege and no EXECUTE on
--     record_external_pull (probed: 42501);
--   * record_external_pull's OWN checks, which are the only thing
--     standing between a caller and a forged receipt.
--
-- That is one wall in the definer path, not two, and it is worth
-- saying plainly: the function's checks are load-bearing on their
-- own. The policies below still govern SELECT for real, and still
-- govern INSERT for any non-definer path a later migration might
-- grant, which is why they stay.
alter table public.external_pull_log force row level security;

-- ---- Privileges ------------------------------------------------
-- Explicit, never GRANT ALL. Supabase's default privileges hand ALL
-- to anon, authenticated and service_role on every new table, so the
-- revokes below are what actually decides anything; granting the one
-- verb this table wants would otherwise add nothing.
revoke all on public.external_pull_log from public;
revoke all on public.external_pull_log from anon;
revoke all on public.external_pull_log from authenticated;
revoke all on public.external_pull_log from service_role;

-- Reads for both. Writes for neither: INSERT arrives only through
-- record_external_pull(), and UPDATE and DELETE arrive from nowhere
-- at all.
grant select on public.external_pull_log to authenticated;
grant select on public.external_pull_log to service_role;

-- ---- SELECT ----------------------------------------------------
-- Form D throughout: the helper is wrapped in a scalar subquery so
-- the planner evaluates it once per statement rather than per row.
drop policy if exists external_pull_log_select on public.external_pull_log;
create policy external_pull_log_select on public.external_pull_log
for select to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) is not null
    and (select public.auth_company_id()) = public.external_pull_log.company_id
  )
);

-- The guide mirror. See the role note in the header.
drop policy if exists external_pull_log_select_guide on public.external_pull_log;
create policy external_pull_log_select_guide on public.external_pull_log
for select to authenticated
using (public.is_guide_for(public.external_pull_log.company_id));

-- ---- INSERT ----------------------------------------------------
-- authenticated holds no INSERT privilege, so nothing reaches this
-- policy today.
--
-- IT IS NOT A SECOND WALL AROUND THE DEFINER FUNCTION. See the note
-- on FORCE above: postgres bypasses RLS, so the function's write is
-- not filtered by this. Kept because it is the rule any future
-- non-definer INSERT path would have to satisfy, and because writing
-- it down is how the intended shape survives the next migration.
-- Not kept as evidence of anything.
drop policy if exists external_pull_log_insert on public.external_pull_log;
create policy external_pull_log_insert on public.external_pull_log
for insert to authenticated
with check (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) is not null
    and (select public.auth_company_id()) = public.external_pull_log.company_id
  )
  or public.is_guide_for(public.external_pull_log.company_id)
);

-- ---- UPDATE and DELETE: no policies. Deliberately absent. ------
-- Do not add one. A receipt that can be edited is not a receipt. A
-- pull that should not have happened is corrected by a manual entry,
-- which is itself recorded by clearing the entry's origin; the log
-- keeps saying what the machine did, which is the only version of
-- events worth keeping.

-- ---- The write path --------------------------------------------
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
  v_outcome text := p_outcome;
  v_existing_origin text;
  v_entry_exists boolean;
  v_log_id uuid;
begin
  if v_uid is null then
    raise exception 'record_external_pull requires an authenticated caller';
  end if;
  if p_mapping_kind not in ('week_keyed', 'snapshot') then
    raise exception 'record_external_pull: unknown mapping kind %', p_mapping_kind;
  end if;
  if p_outcome not in ('written', 'skipped_manual_exists', 'skipped_stale', 'failed') then
    raise exception 'record_external_pull: unknown outcome %', p_outcome;
  end if;
  if p_outcome = 'written' and p_value is null then
    raise exception 'record_external_pull: a written outcome needs a value';
  end if;
  if p_outcome = 'failed' and p_failure_reason is null then
    raise exception 'record_external_pull: a failed outcome needs a reason';
  end if;

  -- The company comes from the measure. There is no parameter for it,
  -- so there is no argument a caller can pass to write a receipt into
  -- somebody else's log.
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
    -- 42501, not the default P0001. The harness distinguishes a
    -- refusal from a confused error by SQLSTATE, and this IS an
    -- insufficient-privilege refusal: saying so makes the probe's
    -- expectation exact instead of "some error happened".
    raise exception 'record_external_pull: not permitted for this company'
      using errcode = '42501';
  end if;

  -- Manual wins, decided here because here is the only place it can
  -- be decided without a race. A caller that checked first and wrote
  -- second would be correct exactly until two of them ran at once.
  if v_outcome = 'written' then
    select true, e.origin
      into v_entry_exists, v_existing_origin
      from public.success_measure_entries e
     where e.measure_id = p_measure_id
       and e.week_ending = p_week_ending;

    if coalesce(v_entry_exists, false) and v_existing_origin is null then
      v_outcome := 'skipped_manual_exists';
    else
      insert into public.success_measure_entries
        (measure_id, week_ending, value_number, value_text, entered_by,
         origin, pulled_at)
      values
        (p_measure_id, p_week_ending, p_value, null, v_uid,
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

revoke all on function public.record_external_pull(uuid, date, text, text, numeric, text, jsonb) from public;
revoke all on function public.record_external_pull(uuid, date, text, text, numeric, text, jsonb) from anon;
revoke all on function public.record_external_pull(uuid, date, text, text, numeric, text, jsonb) from service_role;
grant execute on function public.record_external_pull(uuid, date, text, text, numeric, text, jsonb) to authenticated;

comment on function public.record_external_pull(uuid, date, text, text, numeric, text, jsonb) is
  'The only write path into external_pull_log, and the only path that writes an entry with an origin. Resolves company_id from the measure rather than taking it as a parameter, checks the caller against that company, and enforces manual-wins by downgrading its own outcome to skipped_manual_exists when a person''s entry already holds the week. Returns the outcome it actually took, which may not be the one it was asked for.';
