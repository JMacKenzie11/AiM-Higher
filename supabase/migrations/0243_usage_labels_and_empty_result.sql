-- Four purposes of their own, and a flag for a call that came back
-- with nothing to say.
--
-- `clarity` WAS THREE FEATURES. Commitment clarity, measure critique
-- and measure target check all logged under it, so when one Sonnet 5
-- call ended at exactly its 400-token cap on 2026-09-24 there was no
-- way to say which feature it was. Each now logs as itself:
-- `commitment_clarity`, `measure_critique`, `measure_target_check`.
-- `clarity` stays valid: 453 rows on production carry it, and a
-- constraint that refused them would fail this migration.
--
-- `hq_brief` is the HQ session brief, which never logged at all. It
-- is not `brief`, which is the dashboard's weekly brief; one label
-- for two features is the problem this migration is fixing.
--
-- `empty_result` is true when the call returned no text: every
-- caller keeps only text blocks, and a model that spent its whole
-- budget thinking returns none. Each caller fell back silently, so
-- the only trace of an empty result was a feature that did nothing.
-- Default false, so every existing row reads as it was logged.
--
-- ORDER MATTERS FOR THE DEPLOY. The code that writes these labels and
-- this column must not reach an instance before this migration does:
-- logCoachTokenUsage is fire-and-forget, so a refused insert is lost
-- without a word (see 0206, where `memory` was dropped that way for
-- the life of coach memory).
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
    'hq_brief',
    'clarity',
    'commitment_clarity',
    'measure_critique',
    'measure_target_check',
    'facilitation',
    'facilitation_retry',
    'insights_analysis',
    'memory',
    'other'
  ));

alter table public.coach_token_usage
  add column if not exists empty_result boolean not null default false;

comment on column public.coach_token_usage.empty_result is
  'The call returned no text. Usually a model that spent its whole max_tokens thinking.';
