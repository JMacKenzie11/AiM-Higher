-- =============================================================
-- Migration 0119: meeting facilitation review
--
-- Adds an opt-in "meeting_facilitation_review" feature on companies:
--   * after each transcript is summarized, a second LLM pass runs
--     against the AiMS Weekly Leadership Meeting framework
--   * the structured review is stored inline on meeting_analyses
--     so a single read of that row hydrates both the summary and
--     the review together
--   * doubles per-meeting LLM cost — off by default, gated by
--     company_features
--
-- Schema:
--   * facilitation_review_json on meeting_analyses. Nullable —
--     historical rows and rows analyzed while the flag was off stay
--     null. Shape is defined in code (src/lib/leadership/facilitation
--     /types.ts); DB is intentionally schemaless here so prompt
--     iterations don't need a migration.
--
-- The feature is registered in VALID_FEATURES in
-- src/lib/companies/actions.ts and in the ModuleFeature union in
-- src/lib/subscriptions/service.ts.
-- =============================================================

alter table public.meeting_analyses
  add column if not exists facilitation_review_json jsonb;
