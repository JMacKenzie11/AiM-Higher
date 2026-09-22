-- =============================================================
-- Migration 0229 — coaching_conversations.is_preview
--
-- A preview conversation runs an UNPUBLISHED draft of an agent's
-- config so a system admin can try it before pressing Publish. It is
-- a real conversation — real messages, real model calls — and that is
-- the problem this column exists to solve.
--
-- ---- WHY A COLUMN AND NOT A CONVENTION ------------------------
--
-- Seven queries aggregate this table for analytics, and every one of
-- them runs on the SERVICE-ROLE client with RLS bypassed, so no
-- policy can exclude a preview for them:
--
--   api/cron/coaching-insights/route.ts    candidates for analysis
--   api/cron/themes/route.ts               theme extraction
--   lib/admin/dashboard-service.ts         conversation counts
--   lib/admin/dashboard-service.ts         message volume
--   lib/admin/dashboard-service.ts         AGENT ADOPTION
--   lib/admin/coaching-insights-service.ts per-agent buckets
--   lib/admin/coaching-insights-service.ts the analyses window
--
-- The obvious implementation was seven hand-written filters agreeing
-- on a convention. That is the kind of agreement the eighth query
-- forgets, and the failure is silent: an admin's rehearsal quietly
-- counted as adoption, inflating the one number the platform
-- dashboard exists to report honestly.
--
-- A named column makes the omission visible instead. `is_preview` is
-- one predicate, greppable, and a query that lacks it is obviously
-- missing something rather than merely different.
--
-- ---- VISIBILITY IS ALREADY HANDLED ----------------------------
--
-- Not by this column. `coaching_conversations` is owner-scoped
-- (`created_by = auth.uid()`, 0021/0105) with shares layered on
-- (0150/0151), so a preview is visible to the admin who started it
-- and nobody else by default. The column is about AGGREGATION, not
-- access, and adding an access meaning to it later would be a second
-- job for one flag.
--
-- The Hub never offers to share a preview, so the share path is not
-- reachable from the surface that makes one. That is a UI guarantee
-- rather than a database one, and it is written here so the next
-- person knows which kind it is.
--
-- ---- MEMORY NEEDS NOTHING -------------------------------------
--
-- The sweep already filters `practice_id is null` (0194-era rule:
-- agents produce no memory), and a preview always carries a
-- practice_id. So previews are excluded from memory by a rule that
-- predates them, not by this column. Stated so nobody "fixes" the
-- sweep later by adding a redundant filter and assumes it was load
-- bearing.
--
-- Default false, so every existing row is correct without a backfill.
-- =============================================================

alter table public.coaching_conversations
  add column if not exists is_preview boolean not null default false;

comment on column public.coaching_conversations.is_preview is
  'True for a conversation started from the Agent Hub to try an '
  'unpublished draft. Excluded from every analytics and scoring '
  'aggregate; see migration 0229. Not an access control: ownership '
  'already scopes it to the admin who started it.';

-- Partial index: the analytics queries all want "the ones that are
-- NOT previews", and previews are a rounding error in the table, so
-- indexing the true side keeps it small while letting the planner
-- skip them.
create index if not exists coaching_conversations_preview_idx
  on public.coaching_conversations (created_by, created_at desc)
  where is_preview;
