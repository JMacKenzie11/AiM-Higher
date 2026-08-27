-- =============================================================
-- Migration 0145: Classroom "trainings" become sections; drop the
-- standalone video fields.
--
-- The 0120 shape put one video at the top of each training row
-- (video_provider + video_id + video_url + thumbnail_url). The new
-- shape puts videos INSIDE the rich text body as inline nodes so
-- an author can drop multiple videos wherever they fit the flow.
-- Nothing else about the training row changes — table name stays
-- classroom_trainings so downstream references (attachments FK,
-- action code paths, tests) don't churn. UI now calls them
-- "Sections".
--
-- Green-field data assumption: this app has no classroom rows in
-- production yet (confirmed by product owner). Dropping columns
-- outright is safe — no backfill or JSON rewrite needed.
-- =============================================================

alter table public.classroom_trainings
  drop column if exists video_provider,
  drop column if exists video_id,
  drop column if exists video_url,
  drop column if exists thumbnail_url;
