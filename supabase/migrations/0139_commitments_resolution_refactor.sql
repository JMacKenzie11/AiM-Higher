-- =============================================================
-- Migration 0139 — commitments resolution model refactor
--
-- Reshapes the resolved-state model + adds park / soft-delete /
-- ongoing / resolver-role columns. Companion migration 0140
-- creates the commitment_occurrences table used by ongoing rows.
--
-- Status changes:
--   - `in_progress` is retired entirely. It shipped in 0130 but
--     didn't earn its keep — the concept collapses back into `open`.
--     Every in_progress row → open.
--   - `kept` splits into `kept_on_time` and `kept_late`. Kept on
--     time means the resolution landed on or before the due date.
--     Kept late means it landed after — same "did the work" signal,
--     but a distinct display (check + small clock badge) and NOT
--     counted in the Follow-Through numerator.
--   - Historical `missed` rows with a `completed_at` timestamp
--     become `kept_late`. Missed without completion stays Missed.
--     This is the best signal available for legacy rows; new
--     resolutions record the on-time-vs-late split explicitly at
--     mark time. Some legacy rows may have had completed_at stamped
--     at close time regardless of whether the work was actually
--     done — that's an accepted false-positive of the migration.
--
-- New columns:
--   - deleted_at (timestamptz) — soft delete. Every UI + metric
--     filters `where deleted_at is null`. Retained solely so future
--     coaching signals can be built if wanted. INTENTIONALLY
--     REVERSIBLE — flip a flag to un-delete, and we can query
--     history for churn patterns without a data restore.
--   - parked_at (timestamptz) — parking lot. Removes the row from
--     weekly flow, overdue logic, and Follow-Through. Bring back =
--     null it out and set a new due_date.
--   - is_ongoing (boolean) — repeating weekly commitment. Only
--     one row per commitment_id no matter how many weeks it runs;
--     per-week resolutions land in commitment_occurrences (0140).
--   - resolved_by_role (text) — 'owner' | 'admin' | 'guide' when
--     the row is resolved, else null. Lets downstream distinguish
--     "no reason given by owner" from "resolved by admin in the
--     meeting." Loose enum (text) so we can add roles without a
--     migration.
--   - resolved_by_profile_id (uuid) — who actually clicked the
--     button. Useful for admin-attribution on scoring context.
--
-- The `missed_needs_reason` CHECK is dropped. Admins are exempt
-- from ALL reason requirements per the new model, so a DB-level
-- CHECK enforcing missed_reason NOT NULL blocks legitimate
-- admin-in-the-meeting resolutions. Reason enforcement moves
-- fully to the action layer, where it can be role-aware.
-- =============================================================

-- 1. Drop the missed_needs_reason CHECK — the app layer enforces
--    reason requirements now (admins exempt).
alter table public.commitments
  drop constraint if exists missed_needs_reason;

-- 2. Drop the status CHECK so we can update rows to new values.
alter table public.commitments
  drop constraint if exists commitments_status_check;

-- 3. Data migration. Order matters — missed → kept_late uses the
--    'missed' selector, so run that BEFORE bumping missed itself.
--    (No-op here since we're not bumping missed's own label, but
--    still: keep the ordering explicit for future readers.)

-- 3a. in_progress collapses back into open.
update public.commitments
set status = 'open',
    completed_at = null,
    missed_reason = null
where status = 'in_progress';

-- 3b. kept → kept_on_time. Every historical kept was on-time by
--     contract (markKeptAction rejected overdue rows).
update public.commitments
set status = 'kept_on_time'
where status = 'kept';

-- 3c. missed with a completed_at → kept_late. Best-effort mapping
--     of the old conflated 'missed' bucket into the new two-way
--     split. missed_reason (if present) is preserved on the row
--     but is no longer required.
update public.commitments
set status = 'kept_late'
where status = 'missed'
  and completed_at is not null;

-- 4. Reapply the CHECK with the new value set.
alter table public.commitments
  add constraint commitments_status_check
  check (status in ('open', 'kept_on_time', 'kept_late', 'missed'));

-- 5. New columns.
alter table public.commitments
  add column if not exists deleted_at timestamptz,
  add column if not exists parked_at timestamptz,
  add column if not exists is_ongoing boolean not null default false,
  add column if not exists resolved_by_role text
    check (resolved_by_role is null or resolved_by_role in ('owner','admin','guide')),
  add column if not exists resolved_by_profile_id uuid
    references public.profiles(id) on delete set null;

-- 6. Partial indexes for the two soft-hide columns — most queries
--    exclude rows where the column is not null, so the hot path
--    only touches "live" commitments.
create index if not exists commitments_live_idx
  on public.commitments (company_id, week_ending)
  where deleted_at is null and parked_at is null;

create index if not exists commitments_parked_idx
  on public.commitments (company_id, parked_at)
  where parked_at is not null and deleted_at is null;
