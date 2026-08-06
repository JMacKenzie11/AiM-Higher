-- =============================================================
-- Migration 0122 — companies.industry
--
-- A free-text field captured when a company is created and
-- editable later from the company settings page. Nullable because
-- every existing row predates the column and industry isn't a hard
-- gate on any feature — it's a profile detail that helps coaching
-- context and future analytics.
-- =============================================================

alter table public.companies
  add column if not exists industry text;
