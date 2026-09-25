-- =============================================================
-- Migration 0236 — stored score parts, and due dates nobody named
--
-- Two additive changes, both presentation-driven, both nullable or
-- defaulted so every existing row reads exactly as it did.
--
-- ---- 1. meeting_analyses: the score and what it was made of ------
--
-- The facilitation overall used to be a separate model judgement,
-- which is why it never derived from the four parts shown beside it.
-- It is now computed in code (src/lib/leadership/facilitation/
-- score.ts) as a weighted average of Rhythm, Accountability,
-- Alignment (each 0 to 10) and Agenda sections (0 to 5, scaled to
-- 10 before weighting).
--
-- The parts, the result AND the weights used are stored, so a
-- historical score is reproducible from its own row, and a later
-- change of weights can be re-applied to past meetings deliberately
-- rather than silently by reading them through today's constant.
--
-- Null on every row written before this. The parts of older rows do
-- exist inside facilitation_review_json and can be back-filled from
-- there by a script, on a separate go; this migration does not write
-- data.
--
-- ---- 2. commitments.due_date_defaulted --------------------------
--
-- When nobody in a meeting names a day, the pipeline gives the
-- commitment meeting date + 7. That is right as a working date and
-- wrong as something to show: fourteen "September 29"s on one
-- meeting read as fourteen deadlines somebody agreed. The flag marks
-- a date the floor supplied, so the page can say "By next meeting"
-- and show a date only where one was said.
--
-- Cleared by every action that sets a date on purpose (reschedule,
-- bring back from parked, the ongoing roll-forward): a date a person
-- chose is a date. False for every existing row, which keeps showing
-- its date as before.
-- =============================================================

alter table public.meeting_analyses
  add column if not exists score_rhythm smallint
    check (score_rhythm between 0 and 10),
  add column if not exists score_accountability smallint
    check (score_accountability between 0 and 10),
  add column if not exists score_alignment smallint
    check (score_alignment between 0 and 10),
  add column if not exists score_agenda smallint
    check (score_agenda between 0 and 5),
  add column if not exists score_overall numeric(4, 2)
    check (score_overall between 0 and 10),
  add column if not exists score_weights jsonb;

comment on column public.meeting_analyses.score_overall is
  'Weighted average of the four score_* parts, computed in code '
  '(facilitation/score.ts), exact to two decimals. Never a model '
  'judgement. Null when any part is missing or the transcript was '
  'insufficient.';
comment on column public.meeting_analyses.score_weights is
  'The weights, in percent, that produced score_overall, e.g. '
  '{"accountability":30,"rhythm":25,"alignment":25,"agenda":20}.';
comment on column public.meeting_analyses.score_agenda is
  'Agenda sections, 0 to 5, as judged. Scaled to 10 before weighting.';

alter table public.commitments
  add column if not exists due_date_defaulted boolean not null default false;

comment on column public.commitments.due_date_defaulted is
  'True when due_date was supplied by the one-week floor because '
  'nobody named a day. Shown as "By next meeting". Cleared by any '
  'action that sets the date deliberately.';
