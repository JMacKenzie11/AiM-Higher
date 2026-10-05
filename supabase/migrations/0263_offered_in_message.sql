-- =============================================================
-- Migration 0263: which offer started a guided session
--
-- Aimee offers a guided session in an open conversation as a card
-- with "Talk it through" (Jason, 2026-10-05). Clicking it starts a
-- new conversation running that session. This records which offer,
-- by the assistant message that carried it, so that:
--
--   - a second click, a double click or a reload opens the session
--     already started rather than starting another, and
--   - the card can say the session was started, and open it.
--
-- One per person per offer: unique on (created_by, message). Keyed on
-- the person as well as the message so that nobody can claim someone
-- else's offer and so block it. The app also checks the message is in
-- a conversation the person owns (lib/aimee/session-offer-actions.ts)
-- before writing it.
--
-- NO POLICY CHANGES. Written at insert under
-- coaching_conversations_insert (0261, unchanged), which already
-- holds created_by to the caller; read under
-- coaching_conversations_select, owner only.
-- =============================================================

alter table public.coaching_conversations
  add column if not exists offered_in_message_id uuid
  references public.coaching_messages(id) on delete set null;

create unique index if not exists coaching_conversations_offered_in_message_uniq
  on public.coaching_conversations (created_by, offered_in_message_id)
  where offered_in_message_id is not null;

comment on column public.coaching_conversations.offered_in_message_id is
  'The assistant message whose offer started this guided session. Null unless started from an offer. 0263.';
