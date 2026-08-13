-- =============================================================
-- Migration 0138 — extend discipline CHECK for new scorecard tiles
--
-- Adds two new disciplines to the company_discipline_snapshots
-- CHECK constraint:
--   - solution_seeking  — how well the team runs the 4Ws framework
--     on issues surfaced in leadership meetings (aggregate close-
--     rate across the 4 Ws on the fourws_audit rows)
--   - positive_framing  — appreciative-inquiry practice signal
--     (celebrating wins, reframing problems, asking generative
--     questions). Rolls up from the facilitation review's new
--     positive_framing dimension score plus the three moment arrays.
--
-- Both are gated on the meeting_facilitation_review feature — no
-- point scoring meeting practice if the company hasn't turned on
-- the review pipeline.
-- =============================================================

alter table public.company_discipline_snapshots
  drop constraint if exists company_discipline_snapshots_discipline_check;

alter table public.company_discipline_snapshots
  add constraint company_discipline_snapshots_discipline_check
  check (discipline in (
    'foundation',
    'chart',
    'planning',
    'execution',
    'measures',
    'meetings',
    'solution_seeking',
    'positive_framing'
  ));
