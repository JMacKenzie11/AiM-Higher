-- =============================================================
-- Migration 0116: drop clarity_deliverable
--
-- The clarity model was three criteria (deliverable / timeline /
-- success). Two of those overlap in practice — a shared picture of
-- the deliverable and a well-defined definition of done are the
-- same thing from two angles. And "timeline achievable" isn't
-- something the analyzer can honestly judge from the text alone.
-- New model is two:
--   * timeline — a specific deadline is stated
--   * success  — the definition of done is well-defined
-- Drop the deliverable column entirely; no application code reads
-- it after this migration.
-- =============================================================

alter table public.commitments
  drop column if exists clarity_deliverable;
