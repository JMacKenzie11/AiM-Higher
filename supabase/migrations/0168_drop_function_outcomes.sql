-- Retire the outcome table.
--
-- Migration 0166 promoted every function_outcome into a critical
-- success factor row in success_measures and left both in place so
-- reads could move over one surface at a time. That transition is
-- finished: nothing in the application writes function_outcomes or
-- reads success_measures.outcome_id any more.
--
-- Two things go:
--
--   success_measures.outcome_id  — a KPI's parent now lives in
--                                  csf_kpi_links, which is
--                                  many-to-many by design.
--   function_outcomes            — the table itself.
--
-- Order matters. The column has a foreign key into the table, so it
-- has to go first or the drop fails on a dependency.
--
-- This is not reversible from data still in the database: once the
-- table is gone the pairing survives only in csf_kpi_links, which
-- 0166 populated from exactly this data. Restoring means restoring
-- from a backup, which is why 0166 and 0168 are separate migrations
-- with the application change between them.

-- ---- 1. Policies that read outcome_id ------------------------
--
-- 0166 added function_id-keyed policies alongside the originals.
-- The originals join through outcome_id, so they must go before the
-- column can be dropped. The replacements are already live.

drop policy if exists success_measures_select on public.success_measures;
drop policy if exists success_measures_write on public.success_measures;
drop policy if exists success_measures_select_guide on public.success_measures;
drop policy if exists success_measures_write_guide on public.success_measures;

-- ---- 2. The column -------------------------------------------

drop index if exists success_measures_outcome_id_idx;

alter table public.success_measures
  drop column if exists outcome_id;

-- ---- 3. The table --------------------------------------------

drop table if exists public.function_outcomes cascade;

-- ---- 4. function_id is required now --------------------------
--
-- Every measure of either kind reaches its company through this
-- column. 0166 backfilled it and every write since has set it, so
-- the constraint records what is already true and stops a future
-- write from creating a row no policy can see.

alter table public.success_measures
  alter column function_id set not null;
