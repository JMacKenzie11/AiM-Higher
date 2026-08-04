-- =============================================================
-- Migration 0118: AI target-quality hint on success_measures
--
-- When performance_tracking is on, the create/update action calls
-- Claude to score the target for clarity (measurable, time-bound,
-- direction-aware) and stores a short coaching hint here when the
-- target could be sharper. Cleared automatically when the operator
-- edits the target and it passes.
--
-- Nullable — most targets pass the check and shouldn't render a
-- chip.
-- =============================================================

alter table public.success_measures
  add column if not exists target_hint text;
