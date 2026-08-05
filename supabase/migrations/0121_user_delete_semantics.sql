-- =============================================================
-- Migration 0121 — hard-delete-friendly FKs on profiles.id
--
-- Six tables previously used ON DELETE RESTRICT on their reference
-- to profiles.id, making a user delete fail whenever the person
-- had any work / notes / entries on file. Split them:
--   * work-history rows (commitments, scorecard entries, measure
--     entries, strengths teams) → SET NULL, so the record survives
--     with an orphaned "who owned / entered / created it" slot.
--   * personal rows (coaching conversations + messages) → CASCADE,
--     since RLS already scopes them to the creator.
--
-- Requires each affected column to become NULL-able first. All the
-- other set-null FKs on profiles.id already have that shape.
-- =============================================================

-- ---- commitments.owner_id → nullable + set null ---------------
alter table public.commitments
  alter column owner_id drop not null;

alter table public.commitments
  drop constraint commitments_owner_id_fkey;

alter table public.commitments
  add constraint commitments_owner_id_fkey
  foreign key (owner_id) references public.profiles(id) on delete set null;

-- ---- scorecard_entries.entered_by → nullable + set null -------
alter table public.scorecard_entries
  alter column entered_by drop not null;

alter table public.scorecard_entries
  drop constraint scorecard_entries_entered_by_fkey;

alter table public.scorecard_entries
  add constraint scorecard_entries_entered_by_fkey
  foreign key (entered_by) references public.profiles(id) on delete set null;

-- ---- success_measure_entries.entered_by → nullable + set null -
alter table public.success_measure_entries
  alter column entered_by drop not null;

alter table public.success_measure_entries
  drop constraint success_measure_entries_entered_by_fkey;

alter table public.success_measure_entries
  add constraint success_measure_entries_entered_by_fkey
  foreign key (entered_by) references public.profiles(id) on delete set null;

-- ---- strengths_teams.created_by → nullable + set null ---------
alter table public.strengths_teams
  alter column created_by drop not null;

alter table public.strengths_teams
  drop constraint strengths_teams_created_by_fkey;

alter table public.strengths_teams
  add constraint strengths_teams_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

-- ---- coaching_conversations.created_by → cascade --------------
-- Threads are private to the creator (RLS: created_by = auth.uid()).
-- Nobody else can see them, so cascading on user delete loses only
-- the deleted user's own private notes.
alter table public.coaching_conversations
  drop constraint coaching_conversations_created_by_fkey;

alter table public.coaching_conversations
  add constraint coaching_conversations_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete cascade;

-- ---- coaching_messages.created_by → cascade -------------------
-- Messages already cascade when their parent conversation goes.
-- Making the profile FK cascade too is belt-and-suspenders: if a
-- future flow ever inserts a message with a different created_by
-- than the conversation creator, it won't block the delete.
alter table public.coaching_messages
  drop constraint coaching_messages_created_by_fkey;

alter table public.coaching_messages
  add constraint coaching_messages_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete cascade;
