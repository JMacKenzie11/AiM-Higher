-- =============================================================
-- Migration 0130 — commitments.status gains 'in_progress'
--
-- Team members without an "in progress" option were resolving
-- half-done work as Kept (dishonest) or leaving it Open (goes
-- overdue on Friday, artificially inflates the Needs Attention
-- pile). Neither reflects reality. Adding an explicit
-- 'in_progress' state closes the honesty gap.
--
-- Semantics:
--   - 'in_progress' is an *active* state, like 'open'. Excluded
--     from Follow-Through Rate (both numerator and denominator),
--     same as 'open'. The rate stays a Kept-vs-Missed ratio.
--   - No auto-transitions. The owner chooses to move an open
--     commitment to in_progress and later to kept / missed.
--   - Overdue behavior is unchanged — in_progress rows past their
--     due date still count as needing attention (owner deliberately
--     said "not done yet, still working").
--
-- Related: migration 0011 dropped the earlier 'carried' state.
-- This is *not* a resurrection of carried — carried moved a
-- commitment to next week automatically. in_progress just marks
-- current state honestly and lets the owner keep working on it.
-- =============================================================

alter table public.commitments
  drop constraint if exists commitments_status_check;

alter table public.commitments
  add constraint commitments_status_check
  check (status in ('open', 'in_progress', 'kept', 'missed'));
