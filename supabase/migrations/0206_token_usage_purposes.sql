-- Two purposes the application already uses and the database refuses.
--
-- `memory` HAS BEEN SILENTLY DROPPED SINCE COACH MEMORY SHIPPED.
-- CoachUsagePurpose in src/lib/coach/usage.ts lists it; this
-- constraint does not. logCoachTokenUsage is called with `void` — the
-- write is fire-and-forget by design, so a check violation goes
-- nowhere and nobody hears about it.
--
-- Measured on production before this migration: 681 usage rows, every
-- other purpose represented, `memory` at zero. Distilling a finished
-- conversation is a model call whose cost has never appeared on the
-- cost dashboard.
--
--     clarity 267 · brief 113 · analyzer 80 · turn 64
--     insights_analysis 53 · facilitation 44 · themes 35
--     title 14 · rd 11 · memory 0
--
-- `facilitation_retry` is new, and arrives with the retry it names.
-- About one facilitation review in ten comes back having scored
-- nothing, so the analyzer now asks a second time. Two usage rows for
-- one meeting is the truth — two calls were made — and a cost review
-- that cannot tell a retry from a double-charge learns the wrong
-- lesson from it.
--
-- A source-level test now asserts this list and the TypeScript union
-- agree, so the next purpose cannot be added to one and forgotten in
-- the other.
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
    'other'
  ));
