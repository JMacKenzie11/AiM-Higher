-- =============================================================
-- Migration 0132 — practice columns on coaching_conversations
--
-- Guided Practices layer on top of existing coaching infrastructure.
-- A practice session is a coaching conversation with:
--   * practice_id   — registry key (e.g. 'prepare-a-hard-conversation')
--   * partner_profile_id — optional reference to a co-worker the
--     practice is about, so the prompt can attach a strict-allow-list
--     partner_context block.
--
-- Both columns are nullable and additive; existing rows are
-- unaffected. RLS is unchanged: coaching_conversations SELECT is
-- already scoped to created_by = auth.uid(), so practice sessions
-- inherit the same absolute privacy every coaching thread has.
--
-- Practice sessions themselves use mode='general' with
-- subject_profile_id=null (matching migration 0105's mode + subject
-- shape constraints). The practice_id column is the differentiator;
-- the partner_profile_id column powers optional partner context.
-- =============================================================

alter table public.coaching_conversations
  add column if not exists practice_id text,
  add column if not exists partner_profile_id uuid
    references public.profiles(id) on delete set null;

-- Filter index for the user's own practice list ("show me my
-- practices for this specific type"). Partial so the index only
-- holds rows that actually carry a practice.
create index if not exists coaching_conversations_practice_idx
  on public.coaching_conversations(created_by, practice_id, updated_at desc)
  where practice_id is not null;
