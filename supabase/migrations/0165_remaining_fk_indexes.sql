-- =============================================================
-- Migration 0165: the foreign keys still lacking an index.
--
-- Migration 0161 covered the hot read paths found by the
-- performance audit. These are the remaining unindexed foreign
-- keys worth having. Plain CREATE INDEX, not CONCURRENTLY, for the
-- same reason recorded in 0161: the CLI wraps each migration in a
-- transaction, and at current volume each build is milliseconds.
-- =============================================================

-- coach/service.ts lists a company's conversations, and the
-- coaching-insights cron scans by company. Unindexed until now.
create index if not exists coaching_conversations_company_idx
  on public.coaching_conversations (company_id);

-- ON DELETE RESTRICT to profiles with no index, so deleting a
-- profile sequentially scanned the largest table in the schema.
-- deleteUserAction is rare but this made it arbitrarily slow as
-- message volume grows.
create index if not exists coaching_messages_created_by_idx
  on public.coaching_messages (created_by);

-- The issues_update_creator RLS policy keys on this column, so it
-- is read on every issue update by a non-admin.
create index if not exists issues_created_by_idx
  on public.issues (created_by);

create index if not exists session_briefs_based_on_meeting_idx
  on public.session_briefs (based_on_meeting_id)
  where based_on_meeting_id is not null;

-- Small table, but every ingest cycle and every company settings
-- page filters it by company.
create index if not exists transcript_sources_company_idx
  on public.transcript_sources (company_id);
