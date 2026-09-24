-- =============================================================
-- Migration 0234 — meeting_analyses.coverage_json
--
-- The extraction pass cannot check its own recall: asking one call
-- to both extract and confirm it extracted everything gets you a
-- model agreeing with itself. A separate check reads the transcript
-- against the extracted list and names what is missing.
--
-- ---- WHY IT IS STORED RATHER THAN LOGGED -----------------------
--
-- The point of the check is a weekly number: how often the
-- extraction misses something, across every client. A warning in
-- Vercel's logs tells whoever greps them, and nobody greps them on
-- behalf of a trend.
--
-- ---- IT REPORTS, IT DOES NOT ADD -------------------------------
--
-- Nothing here becomes a commitment. A miss is a line a person
-- reads. An extraction that quietly invents work is worse than one
-- that quietly drops it: the dropped one is still in the transcript,
-- and the invented one is on a page with somebody's name against it.
--
-- Null for every row written before this, and for any run where the
-- check itself failed — which is different from a run that found
-- nothing, and that difference is exactly what a trend needs.
-- =============================================================

alter table public.meeting_analyses
  add column if not exists coverage_json jsonb;

comment on column public.meeting_analyses.coverage_json is
  'Result of the recall check: { missed: [{quote, speaker, reason}], '
  'checked: n }. Null when the check did not run or failed, which is '
  'NOT the same as an empty missed list. Reported to a person, never '
  'used to create commitments.';
