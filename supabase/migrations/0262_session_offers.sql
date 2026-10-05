-- =============================================================
-- Migration 0262: what Aimee needs to offer a guided session
--
-- Aimee offers a guided session (an agent) from an open conversation
-- when one would help, and the person starts it with a button (Jason,
-- 2026-10-05). Two columns, both read by that feature and written by
-- nothing else yet:
--
--   agents.offer_when
--     One sentence, written for Aimee, saying when to offer this
--     session: "someone needs to raise a problem with a person and
--     isn't sure how to start". The description says what a session
--     IS, for its card; this says what a person SOUNDS LIKE when they
--     need it. Null means Aimee never offers it, which is right for a
--     session that only makes sense opened from somewhere specific
--     (Debrief a meeting needs a meeting) and is the default for a
--     new one until somebody writes the line.
--
--   coaching_conversations.handoff_summary
--     The short summary Aimee writes when offering a session, shown
--     on the offer card and carried into the new conversation, so the
--     session picks up where the open conversation left off. Null on
--     every conversation not started from an offer.
--
-- NO POLICY CHANGES.
--   agents: agents_update already admits only a system_admin on the
--     authoring instance (0231); this column rides on it, as title and
--     description do.
--   coaching_conversations: written at insert under
--     coaching_conversations_insert (0261, unchanged), and afterwards
--     only by the owner under coaching_conversations_update. The
--     summary is the owner's own words about their own conversation.
--
-- THE FIVE EXISTING SESSIONS get their sentence here, so every
-- instance has it without a Hub edit on each. Only where it is still
-- null, so a line written in the Hub is never overwritten. Debrief a
-- meeting and the E2E test agent stay null on purpose.
-- =============================================================

alter table public.agents
  add column if not exists offer_when text;

alter table public.agents
  drop constraint if exists agents_offer_when_length;
alter table public.agents
  add constraint agents_offer_when_length
  check (offer_when is null or char_length(offer_when) between 1 and 300);

comment on column public.agents.offer_when is
  'When Aimee should offer this session, in one sentence written for Aimee. Null: never offered. 0262.';

alter table public.coaching_conversations
  add column if not exists handoff_summary text;

alter table public.coaching_conversations
  drop constraint if exists coaching_conversations_handoff_summary_length;
alter table public.coaching_conversations
  add constraint coaching_conversations_handoff_summary_length
  check (handoff_summary is null or char_length(handoff_summary) between 1 and 1500);

comment on column public.coaching_conversations.handoff_summary is
  'Summary Aimee carried into this session from the conversation that offered it. Null unless started from an offer. 0262.';

update public.agents as a
set offer_when = v.offer_when
from (
  values
    (
      'prepare-a-hard-conversation',
      'Someone needs to raise a problem with a person, such as missed commitments, behaviour or expectations that need resetting, and isn''t sure how to start or worries it will go badly.'
    ),
    (
      'navigate-emotionally-charged-conversation',
      'Someone is dealing with a person who is upset, defensive or reactive, or expects a conversation to get heated, and wants that person to feel heard.'
    ),
    (
      'ask-better-questions',
      'Someone is preparing a meeting, a one-to-one or a conversation and wants questions that open up thinking, or is stuck on a question that keeps people focused on the problem.'
    ),
    (
      'functional-chart-builder',
      'A leader wants to set up or rethink who is accountable for what across the business, or says their functional chart is missing or out of date.'
    ),
    (
      'role-description',
      'A leader wants to write or update a role description, define a seat before hiring for it, or get clear on what a role is responsible for.'
    )
) as v(slug, offer_when)
where a.slug = v.slug
  and a.offer_when is null;
