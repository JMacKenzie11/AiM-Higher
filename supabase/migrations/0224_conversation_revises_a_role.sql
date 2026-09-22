-- =============================================================
-- Migration 0224 — a conversation can be revising a role
--
-- A saved role description is revised by opening a NEW conversation
-- with the agent, because the original one is private to whoever
-- held it. That is the right privacy model and it is not changing:
-- the document is the artefact and the conversation is the workings,
-- and a second admin needs the artefact, which RLS already shows to
-- every member of the company.
--
-- What they also need is for Save to know which role they are
-- revising.
--
-- ---- THE BUG THIS FIXES ----------------------------------------
--
-- resolveRoleId picks the role a saved document extends, in order:
-- one this CONVERSATION already saved, then the role row for an
-- on-chart function, then a new role.
--
-- A second person is in a new conversation, so the first test
-- misses. For an on-chart role the second catches it and they get
-- the next version. For an OFF-CHART role there is no function to
-- match on, so it falls through and creates a duplicate role: two
-- rows for one job, each with its own version 1, and nothing says
-- so. Live today; it needs two people and a role that is not on the
-- chart.
--
-- ---- WHY A COLUMN AND NOT THE DOCUMENT -------------------------
--
-- The alternative was to have the agent carry the role id in the
-- JSON it emits. Identity is the wrong thing to trust a model with:
-- the first real conversation with this agent emitted `title` for
-- `category` and a bare string for `function`, all reasonable
-- guesses, and a uuid repeated slightly wrong is a silent fork of a
-- document's history rather than a parse failure somebody sees.
--
-- Set by the Revise entry point, read by the save action, never
-- written by the model.
--
-- source_conversation_id keeps the job 0221 gave it: provenance.
-- It stopped being identity, which it was quietly doing.
--
-- ---- ON DELETE -------------------------------------------------
--
-- `set null`. Deleting a role description should not take the
-- conversation about it with it; the chat is still the person's own
-- record of the thinking, and it simply stops pointing at a
-- document that is gone.
-- =============================================================

alter table public.coaching_conversations
  add column if not exists revising_role_id uuid
    references public.role_descriptions(id) on delete set null;

create index if not exists coaching_conversations_revising_role_idx
  on public.coaching_conversations (revising_role_id)
  where revising_role_id is not null;

-- RLS is unchanged. coaching_conversations already scopes a
-- conversation to its owner and its shares, and this column is
-- readable and writable exactly where the row is. A person who
-- cannot open the conversation cannot see what it revises; a person
-- who can was already trusted with everything in it.
