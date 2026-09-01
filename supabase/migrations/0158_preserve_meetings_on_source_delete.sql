-- =============================================================
-- Migration 0158: never destroy meeting history when a transcript
-- source is removed.
--
-- Before this migration: meetings.source_id was NOT NULL with a
-- foreign key of ON DELETE CASCADE to transcript_sources. Removing
-- a Drive folder (via removeSourceAction or a direct DB delete)
-- cascade-wiped every meeting the folder ever produced — every
-- analysis, every commitment context, gone. Not recoverable
-- without a Supabase point-in-time restore.
--
-- New shape:
--   * source_id is nullable — a meeting can outlive its source.
--   * FK becomes ON DELETE SET NULL — deleting the source keeps
--     the meeting rows and just detaches them.
--
-- The unique constraint (source_id, provider_file_id) stays. Once
-- source_id goes NULL those detached rows can't collide with new
-- ingests (Postgres treats NULLs as distinct for UNIQUE), which
-- is exactly what we want — the historical row is preserved and
-- a reconnect can re-ingest the same file into a fresh row without
-- a constraint conflict.
--
-- The removeSourceAction comment ("meetings go with it") is now
-- wrong; the code fix in the same PR strips the stale nullify
-- attempt and updates the comment.
-- =============================================================

alter table public.meetings
  alter column source_id drop not null;

alter table public.meetings
  drop constraint meetings_source_id_fkey;

alter table public.meetings
  add constraint meetings_source_id_fkey
    foreign key (source_id)
    references public.transcript_sources(id)
    on delete set null;
