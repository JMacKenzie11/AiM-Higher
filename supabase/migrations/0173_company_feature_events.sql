-- =============================================================
-- Migration 0173: entitlement changes leave a record.
--
-- company_features is a CURRENT-STATE table. Enabling inserts a row,
-- disabling DELETES it (src/lib/companies/actions.ts), and re-enabling
-- inserts a fresh one whose enabled_at defaults to now(). So the table
-- can answer "is this on?" and cannot answer "was this on in August?"
-- — the moment a feature is switched off, every trace that it was ever
-- on is gone, and enabled_at on a re-enabled row overwrites the
-- previous grant.
--
-- WHY THIS MATTERS ENOUGH TO GET A TABLE. On 2026-09-08 the weekly
-- scorecard cron was found to have recorded four feature-gated
-- disciplines as "not enabled" for every company on every snapshot
-- since 2026-08-13, because it read entitlements through a
-- session-scoped client that resolved to `anon` (fixed in #59). The
-- repair question was then: which of those rows were wrong, and which
-- were companies that genuinely had the module off?
--
-- That question was only partly answerable. Rows where enabled_at was
-- earlier than the snapshot date proved the flag was on. Everything
-- else was unknowable, because a flag switched off during the window
-- leaves nothing behind. 67 rows could be called wrong; 37 could not
-- be called either way, and the history could not be rebuilt.
--
-- The gap was not that the data was hard to find. It was never
-- recorded.
--
-- SHAPE: an append-only event log beside the current-state table,
-- rather than a `disabled_at` column on it.
--
-- A soft-disable column looks simpler and does not actually work. The
-- primary key is (company_id, feature), so a feature that goes
-- on → off → on has one row to hold two enable intervals: re-enabling
-- has to clear disabled_at and reset enabled_at, which destroys the
-- middle of the history. "Answerable forever" rules out any shape
-- where a later write can overwrite an earlier fact.
--
-- An interval table (from/to per period) answers "as of X" in one
-- indexed lookup, which is tempting, but it makes CURRENT state a
-- query with `to is null` — and current state is read on every
-- authenticated page load through getCompanyFeatures. Rewriting that
-- path to fix a historical-reporting gap trades a hot, just-repaired
-- read for a cold one. Not worth it.
--
-- So: current state stays exactly where it is and is read exactly as
-- it is today. The log sits beside it and nothing on the request path
-- touches it.
--
-- WRITTEN BY A TRIGGER, NOT BY THE APP. The app has two write paths
-- today (setCompanyFeaturesAction and create-company), but it is not
-- the only writer: provisioning seeds companies, and migration 0016
-- backfilled this table directly. A log the application maintains is
-- a log that is correct until someone writes SQL by hand — which
-- docs/failure-modes.md E2 records happening, on this database, with a
-- change nobody could see afterwards. A trigger cannot be bypassed by
-- a caller that forgot.
--
-- ANSWERING THE QUESTION. "Was <feature> on for <company> on <date>?"
-- is the last event at or before that date:
--
--   select action = 'enabled'
--     from public.company_feature_events
--    where company_id = $1 and feature = $2
--      and occurred_at <= $3
--    order by occurred_at desc
--    limit 1;
--
-- No row means the feature had never been touched by that date, which
-- is "off".
--
-- WHAT THIS DOES NOT DO. It starts the record now. The backfill below
-- seeds one 'enabled' event per currently-enabled feature at its
-- enabled_at, which is the truth for grants still in force. Features
-- disabled before this migration ran are not recoverable and never
-- will be. The August scorecard window stays partly unknowable; this
-- exists so the next one is not.
-- =============================================================

create table if not exists public.company_feature_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  -- Deliberately NOT a foreign key to company_features. The whole
  -- point is to outlive the row: a delete there must leave this
  -- standing, and an FK would either block the delete or cascade the
  -- history away with it.
  feature text not null,
  action text not null check (action in ('enabled', 'disabled')),
  occurred_at timestamptz not null default now(),
  -- Who did it, when that is knowable. auth.uid() is null for
  -- service-role writes (provisioning, seeds, migrations), and a null
  -- here honestly means "not a user action" rather than "unknown
  -- user".
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- The "as of" query above: company + feature, newest first.
create index if not exists company_feature_events_lookup_idx
  on public.company_feature_events (company_id, feature, occurred_at desc);

-- ---- The trigger ---------------------------------------------
--
-- SECURITY DEFINER so it writes regardless of the caller's rights:
-- the table forbids INSERT to authenticated entirely (see RLS below),
-- and a company_admin toggling a feature must still leave a record.

create or replace function public.log_company_feature_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    insert into public.company_feature_events
      (company_id, feature, action, actor_id)
    values (new.company_id, new.feature, 'enabled', auth.uid());
    return new;
  elsif (tg_op = 'DELETE') then
    insert into public.company_feature_events
      (company_id, feature, action, actor_id)
    values (old.company_id, old.feature, 'disabled', auth.uid());
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists company_features_log_changes on public.company_features;
create trigger company_features_log_changes
  after insert or delete on public.company_features
  for each row execute function public.log_company_feature_change();

-- ---- Backfill ------------------------------------------------
--
-- One 'enabled' event per currently-enabled feature, stamped at the
-- grant we still have. Guarded by `not exists` so re-running the
-- migration set against a database that already has this cannot
-- double-seed. actor_id is null: nobody alive knows who flipped these.
insert into public.company_feature_events
  (company_id, feature, action, occurred_at, actor_id)
select cf.company_id, cf.feature, 'enabled', cf.enabled_at, null
  from public.company_features cf
 where not exists (
   select 1
     from public.company_feature_events e
    where e.company_id = cf.company_id
      and e.feature = cf.feature
 );

-- ---- RLS -----------------------------------------------------

alter table public.company_feature_events enable row level security;

-- NOT forced, and this is the one place in the schema where that is
-- deliberate rather than an omission.
--
-- FORCE applies policies to the table owner as well. The only writer
-- here is log_company_feature_change(), a SECURITY DEFINER function
-- running as that owner, and there is no INSERT policy for it to
-- satisfy — by design, since granting INSERT to anything would be the
-- hole this table exists to avoid. With FORCE on, the trigger's own
-- insert would be denied and every write to company_features would
-- fail with it: enabling a feature would start returning an error.
--
-- Not forcing costs nothing that matters. The property we want is
-- "no authenticated user can write here", and `enable row level
-- security` with no INSERT/UPDATE/DELETE policy delivers exactly that.
-- FORCE would only add "and neither can the owner", where the owner is
-- precisely who has to.
--
-- Whether Supabase's postgres role carries BYPASSRLS (which would beat
-- FORCE and make this moot) was not assumed either way. See E1 in
-- docs/failure-modes.md: the cheap correct choice beats the one that
-- needs a probe to justify.

-- SELECT: system_admin anywhere, and a guide on companies they are
-- assigned to. Deliberately NOT company members: this is billing-
-- adjacent history about what a tenant is paying for, and the people
-- who need it are the ones who administer the account.
create policy company_feature_events_select on public.company_feature_events
for select to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
  )
);

create policy company_feature_events_select_guide
on public.company_feature_events
for select to authenticated
using (public.is_guide_for(public.company_feature_events.company_id));

-- No INSERT, UPDATE or DELETE policy, for any role. The trigger is
-- SECURITY DEFINER and writes past RLS; nothing else may write here at
-- all. An append-only log that a user can edit is not a log, and one
-- that a user can forge entries in is worse than none.
