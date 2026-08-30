-- =============================================================
-- Migration 0149: Scope training slug uniqueness to (lesson_id)
--
-- Sections (classroom_trainings) had a GLOBAL unique constraint on
-- slug, so a title like "How do I know it's working?" could only
-- ever exist in one lesson across the whole classroom. That doesn't
-- match how the library is actually organized: many lessons share
-- the same recurring section titles (intro, definition, how to
-- know it's working, common pitfalls, etc.).
--
-- The URL already scopes sections by their parent lesson
-- (/classroom/lessons/<lessonSlug>/<sectionSlug>), so per-lesson
-- uniqueness is the right invariant. Every existing slug is
-- globally unique — hence also unique per lesson — so adding the
-- scoped constraint accepts every current row without any data
-- cleanup.
--
-- Legacy /classroom/trainings/<slug> permalink route (single-slug
-- redirect to the canonical URL) still works for every existing
-- section. New sections with duplicated slugs across different
-- lessons won't have a stable single-slug permalink, but they're
-- always reachable via the canonical two-slug URL.
-- =============================================================

-- Drop the auto-generated global unique. Named
-- classroom_trainings_slug_key by Postgres when the column was
-- declared `text not null unique` in migration 0120. Guard with
-- if-exists so re-running the migration is safe.
alter table public.classroom_trainings
  drop constraint if exists classroom_trainings_slug_key;

-- Scoped unique — same slug allowed across different lessons.
alter table public.classroom_trainings
  add constraint classroom_trainings_lesson_slug_key
  unique (lesson_id, slug);
