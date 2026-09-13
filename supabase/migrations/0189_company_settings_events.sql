-- =============================================================
-- Migration 0189: company settings changes leave a record.
--
-- WHY. companies.timezone decides what "today" means for a tenant.
-- The weekly scorecard buckets by date in the company's clock
-- (0013_dashboard_brief.sql, 0137_company_discipline_snapshots.sql,
-- 0174_company_follow_through.sql), so moving a company from
-- America/Anchorage to America/New_York silently re-bucket rows
-- either side of the boundary. Counts change. Nothing in the app
-- says why.
--
-- Until now that column could only be set at creation time or by
-- hand in SQL, and either way the old value was gone the moment it
-- was overwritten. This migration opens the column to an edit path
-- and, in the same breath, makes the change answerable afterwards.
--
-- THIS MIGRATION GRANTS NOTHING. system_admin has held UPDATE on
-- companies since 0004 (form D since 0175:137), and 0176's column
-- guard already refuses every column except `industry` to a
-- company_admin or an aims_guide — timezone included. So the
-- boundary the edit path needs is already in place, and widening it
-- is not what this is for. The harness probe added alongside
-- (grantProbes, scripts/rls-harness.ts) asserts both halves anyway:
-- a system_admin can move the clock, a company_admin and a guide on
-- their own company still cannot. Failure mode E5 says a grant is
-- not real until it has been exercised as the role; the same is true
-- of a denial nobody has tried.
--
-- SHAPE: the same one 0173 chose for entitlements, for the same
-- reason. companies is a current-state table. An append-only log
-- beside it can answer "what was this on 2026-08-13?"; a
-- `previous_timezone` column cannot answer it twice.
--
-- EVERY COLUMN, NOT A WATCHLIST. The trigger compares the two rows
-- as jsonb with `updated_at` removed and writes one event per key
-- that moved. A watchlist naming `timezone` would be a list someone
-- has to remember to extend, and this repo has a failure mode about
-- exactly that (E2, and the denylist note in 0176). The construction
-- here records a column the day it is added rather than the day
-- somebody remembers it.
--
-- The usual objection to logging everything is volume. It does not
-- apply: companies holds one row per tenant and is written when
-- somebody edits an industry, archives an account, or moves a clock.
-- A year of that is smaller than one day of commitments.
--
-- Values are stored as text, from the jsonb. Every column on this
-- table is text, an enum-ish text, or a timestamp; nothing needs a
-- richer type, and text means a column added later does not need
-- this trigger changed to hold it.
--
-- WRITTEN BY A TRIGGER, NOT BY THE APP. Identical reasoning to 0173:
-- the app is not the only writer. Provisioning seeds companies, the
-- soft-delete in deleteCompanyAction goes through the service-role
-- client, and migrations have edited this table directly. A log the
-- application maintains is correct until the next caller forgets.
--
-- NO BACKFILL IS POSSIBLE. Nothing recorded what a company's
-- timezone used to be, so there is no earlier history to seed and
-- there never will be. Unlike 0173, there is not even a current-state
-- row worth stamping: `companies.updated_at` is the time of the last
-- change to ANY column, so seeding "timezone set at updated_at" would
-- manufacture a fact rather than record one. The log starts empty and
-- starts now.
-- =============================================================

create table if not exists public.company_settings_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  -- The column that moved, as it is spelled on the table.
  field text not null,
  -- Both sides, as text. Null means the column was null, which is a
  -- real value here (industry, deleted_at) rather than "unknown".
  old_value text,
  new_value text,
  occurred_at timestamptz not null default now(),
  -- Null for a service-role write (provisioning, seeds, migrations),
  -- which honestly means "not a user action" rather than "unknown
  -- user". Same choice as company_feature_events.actor_id.
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- "What happened to this company, newest first", and the narrower
-- "when did this field last move" both ride this index.
create index if not exists company_settings_events_lookup_idx
  on public.company_settings_events (company_id, field, occurred_at desc);

-- ---- The trigger ---------------------------------------------
--
-- AFTER UPDATE, not BEFORE: the row this records is the one that was
-- actually written. A BEFORE trigger sees a NEW that a later BEFORE
-- trigger may still edit — companies_set_updated_at does exactly
-- that — and would log an intention rather than a fact.
--
-- SECURITY DEFINER so it writes regardless of the caller's rights.
-- The table grants INSERT to nobody (see RLS below), which is the
-- point: an audit log a user can write to is not an audit log.

create or replace function public.log_company_settings_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  before_row jsonb;
  after_row jsonb;
  changed_field text;
  actor uuid;
begin
  -- `updated_at` is machine-maintained by companies_set_updated_at
  -- and moves on every update by definition. Logging it would put a
  -- row in this table for every edit of every other column, saying
  -- nothing.
  before_row := to_jsonb(old) - 'updated_at';
  after_row := to_jsonb(new) - 'updated_at';

  if before_row is not distinct from after_row then
    return null;
  end if;

  actor := auth.uid();

  -- Keys from both sides, so a column that went null-to-value and one
  -- that went value-to-null are both caught. `is distinct from` is
  -- the null-safe comparison, and is right here for the same reason
  -- it is wrong in a tenant predicate: both sides are values of the
  -- same row, not a caller compared to a tenant.
  for changed_field in
    select key from jsonb_each(before_row)
    union
    select key from jsonb_each(after_row)
  loop
    if before_row -> changed_field is distinct from after_row -> changed_field then
      insert into public.company_settings_events
        (company_id, field, old_value, new_value, actor_id)
      values (
        new.id,
        changed_field,
        before_row ->> changed_field,
        after_row ->> changed_field,
        actor
      );
    end if;
  end loop;

  return null;
end;
$$;

drop trigger if exists companies_log_settings_changes on public.companies;
create trigger companies_log_settings_changes
  after update on public.companies
  for each row execute function public.log_company_settings_change();

-- ---- RLS -----------------------------------------------------

alter table public.company_settings_events enable row level security;

-- NOT forced, for the reason 0173 sets out at length: FORCE applies
-- policies to the table owner, the only writer here is a SECURITY
-- DEFINER trigger running as that owner, and there is no INSERT
-- policy for it to satisfy — deliberately. With FORCE on, the
-- trigger's insert would be denied and every UPDATE on companies
-- would fail with it.

-- SELECT: system_admin only, and that is not an oversight. The only
-- role that can change any of these columns without going through
-- 0176's `industry` exemption is system_admin, so it is the only role
-- with a change of its own to look up. Widening this to guides or
-- company admins is one policy on the day somebody asks for it.
create policy company_settings_events_select
on public.company_settings_events
for select to authenticated
using ((select public.auth_role()) = 'system_admin');

-- No INSERT, UPDATE or DELETE policy, for any role. The trigger
-- writes past RLS; nothing else may write here at all.
