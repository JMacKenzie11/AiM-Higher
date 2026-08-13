-- =============================================================
-- Migration 0136 — extend coach_token_usage.purpose enum
--
-- The coach_token_usage table (migration 0133) was named + scoped
-- for coach-only calls. In practice we're now logging every model
-- call the platform makes so the admin dashboard's Token spend card
-- reflects real whole-platform spend, not just coach turns.
--
-- This migration widens the CHECK constraint on `purpose` to accept
-- the additional subsystems that log alongside coach:
--
--   analyzer     — meeting transcript analysis (2 calls per meeting)
--   rd           — role description generator + recommend
--   strengths    — assessment narrative, results, team insights
--   brief        — dashboard "Week in review" once-per-day brief
--   clarity      — commitment clarity + measure critique + target check
--   facilitation — leadership facilitation review
--
-- Existing values ('turn', 'title', 'themes', 'other') are preserved.
-- The table name stays as-is for now; a table rename would cascade
-- through the whole dashboard read path and isn't worth the churn
-- in the same PR.
-- =============================================================

alter table public.coach_token_usage
  drop constraint coach_token_usage_purpose_check;

alter table public.coach_token_usage
  add constraint coach_token_usage_purpose_check
    check (purpose in (
      'turn',
      'title',
      'themes',
      'analyzer',
      'rd',
      'strengths',
      'brief',
      'clarity',
      'facilitation',
      'other'
    ));
