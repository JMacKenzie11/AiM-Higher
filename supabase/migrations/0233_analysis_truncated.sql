-- =============================================================
-- Migration 0233 — meeting_analyses.truncated
--
-- The analysis call had max_tokens 5000 and no stop_reason check,
-- so a long meeting produced a summary that stopped mid-sentence and
-- was stored exactly as it arrived. Measured on production before
-- this migration: of 36 stored analyses, 6 were missing sections 5,
-- 6 and 7 outright, and Benson Seafood's ended on the words
-- "current stock to be".
--
-- The prompt puts the most useful sections last — Decisions Made and
-- the carry-forward list — so the cut always landed on the part a
-- leader actually reads.
--
-- ---- WHY A COLUMN AND NOT A HEURISTIC --------------------------
--
-- The renderer cannot tell. "Ends without terminal punctuation" is
-- the check I used to size the problem and it is a guess: a summary
-- legitimately ending on a bullet trips it. The API already knows
-- the answer exactly — stop_reason === "max_tokens" — and that fact
-- exists for one moment inside the analyze call. This is where it
-- gets kept.
--
-- ---- WHY NOT JUST LOG IT ---------------------------------------
--
-- A warning in Vercel's logs tells whoever greps them. Nobody greps
-- them on behalf of a leader reading half a document. The point of
-- recording it is that the page can say so.
--
-- Defaults false, so every row written before this reads as "not
-- known to be truncated" rather than claiming to be complete. The 24
-- historical rows are not backfilled: stop_reason is not recoverable
-- after the fact, and guessing from punctuation would put a warning
-- on summaries that are fine.
-- =============================================================

alter table public.meeting_analyses
  add column if not exists truncated boolean not null default false;

comment on column public.meeting_analyses.truncated is
  'True when the analysis model call ended on stop_reason=max_tokens, '
  'so analysis_markdown is cut off mid-flow. Recorded at write time '
  'from the API response; never inferred from the text.';
