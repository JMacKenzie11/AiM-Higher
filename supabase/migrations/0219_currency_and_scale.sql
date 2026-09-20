-- =============================================================
-- Migration 0219: money, and the scale it is written in
--
-- Two additions that answer one question: how does a measure worth
-- eighteen million dollars get into the system and back out again?
--
-- ---- WHY A CURRENCY TYPE ---------------------------------------
--
-- value_type says what KIND of quantity a measure is, and nothing
-- said "money". A dollar measure was typed 'number' and rendered
-- bare, so the only way to say it was money was to write it in the
-- description: production has "Backlog (signed contract value, $M)"
-- and "Project Performance (on budget - $ and hours)". A name is not
-- a type; nothing can format from it.
--
-- ---- WHY A SEPARATE SCALE --------------------------------------
--
-- Because scale is a different question from kind, and mixing them
-- would need a type per combination. A headcount can be in thousands
-- without being money.
--
-- The scale exists because of a real conflict between the two ways a
-- value arrives:
--
--   A PERSON types it into a 72px cell in the grid. Nobody wants to
--   type 18000000 there, and today they do not: they type 18 and put
--   "$M" in the measure's name.
--
--   AN EXTERNAL PULL takes it from a spreadsheet, where it will be
--   the real number. parseSheetNumber does a plain Number(), with no
--   scaling anywhere in that path, and external pulls are live: two
--   have written values, most recently 2026-09-19.
--
-- Left alone, those two paths would write 18 and 18000000 into the
-- same column and every later read would have to guess which. That
-- is the bug this migration exists to prevent, and it is much
-- cheaper to prevent than to unpick.
--
-- ---- THE RULE ---------------------------------------------------
--
-- STORAGE IS ALWAYS THE TRUE NUMBER. 18000000, never 18.
--
-- Scale applies at the EDGES, both of them:
--
--   entry     the box shows 18 and saves 18000000
--   target    typed the same way, stored the same way, so a target
--             and a value are always comparable without either side
--             knowing about scale
--   display   renders $18.0M
--
-- An external pull needs no translation at all, because what it
-- writes is already canonical. That is the point of choosing this
-- direction rather than scaling on the way in.
--
-- ---- WHY THE TARGET TABLE GETS IT TOO ---------------------------
--
-- 0215 carries value_type on success_measure_targets rather than
-- reading it from the measure, so a past week keeps the reading it
-- was judged under. Scale is the same kind of fact and changes the
-- same judgement: a target of 18 means eighteen million or eighteen
-- depending on it. A week judged under millions has to stay judged
-- under millions.
-- =============================================================

-- ---- 1. 'currency' becomes a value_type -----------------------
--
-- Dropped by the name Postgres gives an inline column check, with
-- `if exists` so a database whose constraint was created some other
-- way is not left half-migrated.

alter table public.success_measures
  drop constraint if exists success_measures_value_type_check;
alter table public.success_measures
  add constraint success_measures_value_type_check
  check (value_type in ('number', 'percent', 'text', 'currency'));

alter table public.success_measure_targets
  drop constraint if exists success_measure_targets_value_type_check;
alter table public.success_measure_targets
  add constraint success_measure_targets_value_type_check
  check (value_type in ('number', 'percent', 'text', 'currency'));

-- ---- 2. The scale ---------------------------------------------
--
-- 'plain' for everything that exists, which is the truthful default:
-- every recorded value in production today is under 1000 and the
-- largest is 627, so nothing is currently written at a scale.

alter table public.success_measures
  add column if not exists value_scale text not null default 'plain'
  check (value_scale in ('plain', 'thousands', 'millions'));

alter table public.success_measure_targets
  add column if not exists value_scale text not null default 'plain'
  check (value_scale in ('plain', 'thousands', 'millions'));

comment on column public.success_measures.value_scale is
  'The scale a person reads and writes this measure in. Storage is ALWAYS the true number; this only decides what the entry box shows and what the page renders, so an external pull writing a raw figure needs no translation. plain | thousands | millions.';

comment on column public.success_measure_targets.value_scale is
  'The scale in force when this target was set, carried for the same reason value_type is: a target of 18 means eighteen or eighteen million depending on it, and a past week has to keep the reading it was judged under.';
