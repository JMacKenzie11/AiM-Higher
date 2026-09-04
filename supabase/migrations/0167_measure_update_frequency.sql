-- =============================================================
-- Migration 0167: how often a measure is expected to be updated.
--
-- Weekly was assumed everywhere. Not every number is worth asking
-- for every week, and a monthly measure currently looks permanently
-- delinquent: the cron nags for it, the board shows it empty for
-- three weeks in four, and the Success Tracking scorer counts it as
-- missed cadence.
--
-- Applies to BOTH kinds. A CSF is often the slower number (monthly
-- revenue, quarterly retention) while the KPIs driving it are
-- weekly, so the column has to sit on the measure, not on the kind.
--
-- The entries table is deliberately untouched. A monthly value is
-- stored against the Friday that closes its period, so
-- (measure_id, week_ending) stays the key and every existing entry
-- stays valid. Frequency changes which Fridays are EXPECTED, not
-- how a value is stored.
-- =============================================================

alter table public.success_measures
  add column if not exists update_frequency text not null default 'weekly'
    check (update_frequency in ('weekly', 'biweekly', 'monthly'));

comment on column public.success_measures.update_frequency is
  'How often this measure is expected to be logged. Drives the performance cron, the on-target board and the cadence half of the Success Tracking score. Values land on the Friday closing their period regardless.';

-- Existing rows keep weekly, which is what every surface already
-- assumed, so this migration changes no behaviour on its own.
