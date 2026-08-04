-- =============================================================
-- Migration 0117: performance tracking feature + measure metadata
--
-- Adds an opt-in "performance_tracking" feature on companies:
--   * measure targets become required at create/edit time
--   * a Saturday cron auto-creates commitments for missed weekly
--     updates (implemented in app code)
--   * dashboards surface generative "gaining ground / streaks /
--     wins / worth a conversation" cards from the measure data
--
-- Schema:
--   * target_direction on success_measures. Some measures are
--     lower-is-better (defect rate, days-to-close) and some are
--     higher-is-better (revenue, on-time %). Without this the
--     auto-check can't say "off target" honestly.
--   * auto_track on success_measures. Some measures are context
--     (headcount, cash on hand) and shouldn't fire commitments
--     even when the flag is on. Default true; owner can opt out
--     per row.
--
-- No feature-row seeding — companies opt in from Settings when
-- they're ready. The feature is registered in VALID_FEATURES in
-- src/lib/companies/actions.ts so it survives the SET-features
-- form's whitelist filter.
-- =============================================================

alter table public.success_measures
  add column if not exists target_direction text
    not null default 'higher_is_better'
    check (target_direction in ('higher_is_better','lower_is_better')),
  add column if not exists auto_track boolean not null default true;
