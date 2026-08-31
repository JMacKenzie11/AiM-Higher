-- =============================================================
-- Migration 0157: extend coach_token_usage.purpose to accept
-- 'insights_analysis' — the nightly per-conversation summarizer
-- that feeds the Pass 2/3 sections of the Coaching insights card.
--
-- Pattern-matches 0136: same CHECK constraint drop-and-recreate.
-- The token spend the summarizer burns should appear in the
-- dashboard cost card next to the other model subsystems.
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
      'insights_analysis',
      'other'
    ));
