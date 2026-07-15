-- =============================================================
-- Phase 7 — Migration 0014: brief prompt-hash cache key.
--
-- The daily AI brief cache needs to invalidate when the prompt
-- itself changes, not just when the day rolls over. Store a short
-- hash of the prompt alongside each row; the code compares the
-- hash on read and regenerates when it mismatches. Robust across
-- deploys, works without a wall-clock cutoff constant.
-- =============================================================

alter table public.dashboard_ai_briefs
  add column if not exists prompt_hash text;
