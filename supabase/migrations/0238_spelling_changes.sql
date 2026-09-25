-- =============================================================
-- Migration 0238 — meeting_analyses.spelling_changes
--
-- What the spelling pass (0237, src/lib/transcripts/spelling.ts)
-- changed in this meeting's analysis, stored beside coverage_json so
-- one weekly report reads both (npm run analysis:weekly).
--
-- ---- WHY STORED RATHER THAN LOGGED -----------------------------
--
-- The same reason as 0234. A wrong correction on a new client is a
-- trend nobody sees in Vercel's logs: the pass is deterministic, so
-- it makes the same wrong change in every meeting until somebody
-- reads a summary closely. Stored, the report prints it the first
-- week it happens, with the words, not only a count.
--
-- Shape: [{ "from": "Graham and Ann", "to": "Grand Manan", "count": 2 }].
-- An empty array is a run that corrected nothing. Null is a row
-- written before this, which the report counts separately.
--
-- The Guide headline is corrected too, after this row is written;
-- its changes are in the `[analyze] spelling` log line, not here.
-- =============================================================

alter table public.meeting_analyses
  add column if not exists spelling_changes jsonb;

comment on column public.meeting_analyses.spelling_changes is
  'Spelling corrections applied to this analysis: [{from, to, count}]. '
  'Empty array: none. Null: written before 0238. Read by the weekly '
  'analysis report; never shown in the app.';
