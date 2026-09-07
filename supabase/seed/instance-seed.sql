-- =============================================================
-- Instance seed: the reference data every new instance needs on
-- day one.
--
-- Applied by `npm run provision` (the seed-data step) against a
-- freshly migrated project, and safe to rerun against an existing
-- one to pick up additions.
--
-- READ supabase/seed/README.md BEFORE ADDING ANYTHING HERE.
-- The short version: reference data changes belong in this file as
-- part of the feature that needs them, never as a direct insert
-- into a live database. New instances are born from this file, so
-- anything added straight to production is silently missing from
-- every instance provisioned afterwards.
--
-- Every statement is idempotent — ON CONFLICT on a real unique
-- constraint, the same pattern the Phase 1 seed scripts use.
--
-- WHAT IS DELIBERATELY NOT HERE
--
--   * Company data of any kind. Companies, profiles, commitments,
--     priorities, meetings, scorecards. A new instance starts empty
--     and its first company is created through the app.
--   * User accounts. The instance's first admin is created by the
--     provisioning step that follows, from the --admin-email flag.
--   * The public.instances registry row. That row is what makes a
--     hostname resolve, so it is written last, to the CONTROL PLANE,
--     by its own step — deliberately not here. Every project has an
--     instances table because the migrations create one; only the
--     control plane's copy is ever read.
--   * Classroom lessons and trainings. Those are authored in the
--     product, not in this repo. A sync pipeline from production is
--     deferred and tracked separately. The category below is
--     structure, not content: without it the Classroom surface has
--     nowhere to put a lesson.
--
-- WHAT IS ALREADY HANDLED ELSEWHERE
--
--   * strengths_items (38 rows) ships in migration
--     0103_strengths_items_seed.sql and therefore arrives with
--     `supabase db push`. It is reference data, but it is already
--     versioned as a migration and duplicating it here would give
--     two sources of truth.
--   * The practices registry is code, not data:
--     src/lib/practices/registry.ts. Nothing to seed.
--   * A new company's default leadership functions are created when
--     the company is created (see createCompanyAction), not per
--     instance.
-- =============================================================

-- ---- Classroom structure ------------------------------------
-- The phase groupings lessons are filed under. Structure rather
-- than content: the Classroom surface needs somewhere to put a
-- lesson before anyone authors one.
insert into public.classroom_categories (name, slug, sort_order)
values
  ('Phase 1', 'build-the-team', 0)
on conflict (slug) do update
  set name = excluded.name,
      sort_order = excluded.sort_order,
      updated_at = now();
