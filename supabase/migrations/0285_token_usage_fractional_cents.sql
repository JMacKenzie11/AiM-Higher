-- 0285: model cost in fractions of a cent, and the meeting calls that
-- were never logged.
--
-- WHY. Jason, 2026-10-14: measure model cost properly before choosing
-- cheaper models. Two things made the cost log wrong:
--
--   1. cost_usd_cents was a whole number of cents, and a Haiku call
--      costs a small fraction of one, so every Haiku row was 0. On
--      production 425 commitment clarity checks, 74 insights summaries
--      and 60 themes runs in 90 days all read as free.
--   2. Six kinds of model call were never logged at all: who was
--      speaking in a meeting, the coverage check, the meeting
--      questions, the Guide's invitation card, the Agent Hub's
--      principles check and the HQ session brief.
--
-- WHAT.
--   1. cost_usd_cents becomes numeric(12,4): cents to four decimal
--      places. Existing rows keep their whole-cent values.
--   2. The purpose check gains those six calls. src/lib/coach/usage.ts
--      lists the same purposes, and usage-purposes.test.ts fails if
--      the two lists differ.
--
-- No policy changes: who may read the table is unchanged (0186, 0191).

alter table public.coach_token_usage
  alter column cost_usd_cents type numeric(12,4) using cost_usd_cents::numeric(12,4);

comment on column public.coach_token_usage.cost_usd_cents is
  'Estimated cost in US cents, to four decimal places (0285), from the rates in src/lib/coach/usage.ts.';

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
    'other'
  ));
