-- =============================================================
-- Migration 0218: a measure says whether it belongs on the dashboard
--
-- One boolean on success_measures, set from the measure's settings
-- panel.
--
-- ---- NOTHING READS IT YET, AND THAT IS DELIBERATE -------------
--
-- The column is here and the control is on the form; no query filters
-- on it. What the dashboard should do with it is a product decision
-- that has not been made, and guessing it would mean shipping a
-- behaviour change disguised as a field.
--
-- So this is the storage, landed on its own, where a later change can
-- read it against data people have already curated rather than
-- against a column full of defaults. If the answer turns out to be
-- something other than the dashboard card, the column is a rename
-- rather than a rethink.
--
-- ---- WHY THE DEFAULT IS TRUE ---------------------------------
--
-- It reads like an opt-in and it is not.
--
-- Every live measure is on the dashboard's Critical Success Factors
-- card today. Whatever ends up reading this column, the first thing
-- it must not do is empty that card for every company on the instance
-- the moment it lands: the card hides itself when there is nothing to
-- plot, so the failure would be a screen quietly going blank.
--
-- True keeps today's behaviour exactly and makes this a way to take
-- things OFF, which is the direction a company with 24 rows wants to
-- travel. Nobody has to set anything for the current view to survive.
-- =============================================================

alter table public.success_measures
  add column if not exists show_on_dashboard boolean not null default true;

comment on column public.success_measures.show_on_dashboard is
  'Whether this measure belongs on the company dashboard. Set from the measure settings panel; NOT read by any query yet (0218). Defaults true so that whatever reads it first does not blank a card that currently shows every measure.';
