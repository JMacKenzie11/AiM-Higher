-- =============================================================
-- Migration 0297: the Capacity Diagnostic's phase 3 calls
--
-- WHY. Jason, 2026-10-22 (Capacity Diagnostic Module: AiMS HQ Build
-- Spec, phase 3): the pledge draft call and the Run a capacity
-- conversation helper. Each logs its cost under its own purpose, so
-- the cost log's purpose check gains two values.
--
--   diagnostic_pledge        drafts the owner's pledge from the kickoff
--   diagnostic_conversation  one turn of the conversation helper
--
-- ACCESS. Nothing else changes: no table, no column, no policy. The
-- Across clients tab reads the published readouts 0296 already stores.
-- =============================================================

alter table public.coach_token_usage
  drop constraint if exists coach_token_usage_purpose_check;

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
    'facilitation_retry',
    'insights_analysis',
    'memory',
    'speakers',
    'coverage',
    'questions',
    'invitation',
    'principles_check',
    'session_brief',
    'headlines',
    'diagnostic_titles',
    'diagnostic_quotes',
    'diagnostic_readout',
    'diagnostic_pledge',
    'diagnostic_conversation',
    'other'
  ));
