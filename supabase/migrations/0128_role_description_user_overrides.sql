-- =============================================================
-- Migration 0128 — user_overrides on role_description_documents
--
-- Prose-heavy sections of the assembled Role Description
-- (Position Summary + Why This Role Matters in v1) can be edited
-- inline by admins on the view page. Those edits need to survive
-- regeneration — otherwise the next Sonnet call wipes the user's
-- tweaks and the flow feels punitive.
--
-- Storing overrides in a separate jsonb column keeps the generated
-- `document` column pristine (still exactly what the model
-- returned) while a merge step at render time layers the user's
-- edits over the top. Restoring a section means clearing that key
-- from user_overrides.
--
-- Shape mirrors a partial RdDocument. v1 only writes
-- positionSummary and whyThisRoleMatters; expanding to other
-- fields later doesn't need a schema change.
-- =============================================================

alter table public.role_description_documents
  add column if not exists user_overrides jsonb;
