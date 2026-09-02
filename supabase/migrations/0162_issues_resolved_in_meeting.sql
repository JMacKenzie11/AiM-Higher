-- =============================================================
-- Migration 0162: record WHICH issues were closed by the
-- "Resolved in meeting" shortcut.
--
-- The meeting summary offers two outcomes for an extracted issue:
-- "Add to open issues" (creates it open, to be worked later) and
-- "Resolved in meeting" (creates it already resolved, because the
-- team settled it in the room). The second creates an issue that
-- never has a linked commitment, so on /issues its Commitment
-- column rendered a bare em-dash — the same as an issue that was
-- resolved some other way without one. The two were
-- indistinguishable after the fact.
--
-- This flag records the provenance at write time rather than
-- inferring it at read time. The alternative considered was a
-- display-time heuristic (resolved + came from a meeting + no
-- commitment), which is wrong for the real case of an issue added
-- OPEN from a meeting and later resolved without a commitment —
-- it would claim the button was used when it wasn't.
--
-- Safe to deploy code ahead of this migration: getIssuesPageData
-- selects "*", so until the column exists the field is simply
-- absent, reads as falsy, and the UI shows today's em-dash.
-- =============================================================

alter table public.issues
  add column if not exists resolved_in_meeting boolean not null default false;

comment on column public.issues.resolved_in_meeting is
  'True when the issue was created already-resolved by the meeting-summary "Resolved in meeting" shortcut. Set at insert; never toggled afterwards.';

-- ---- Backfill ------------------------------------------------
-- Best-effort, for history only. A row created by the shortcut has
-- resolved_at stamped in the SAME insert as created_at, so the two
-- land within milliseconds of each other. An issue added open and
-- resolved later has a real gap between them. Five seconds is a
-- generous margin that no human round trip fits inside.
--
-- Scoped to meeting-sourced resolved rows, so hand-entered issues
-- are never touched.
update public.issues
   set resolved_in_meeting = true
 where status = 'resolved'
   and source_meeting_id is not null
   and resolved_at is not null
   and abs(extract(epoch from (resolved_at - created_at))) < 5;
