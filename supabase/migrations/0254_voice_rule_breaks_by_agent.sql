-- =============================================================
-- Migration 0254: voice rule breaks, by agent, and the first reply
-- as its own surface
--
-- Part 2 of the coaching principles project (Jason, 2026-10-02). One
-- voice check now holds every rule (src/lib/aimee/voice-check.ts), and
-- every reply shown is counted against all of them. A rule is sent
-- back only once a week of these figures says it should be.
--
-- Two things the figures could not say:
--
--   WHICH AGENT. Measured on dev's saved replies, the Role Description
--   Builder asks "Does this look right, or would you like any
--   changes?" at every step, and that is a choice question by the
--   rule's own definition. Without the agent, its steps and a plain
--   coaching reply count as one figure, and a rule that is right for
--   one looks wrong for the other. practice_id is the agent's registry
--   key, as on coaching_conversations (0132); null for plain Aimee.
--
--   THE FIRST REPLY. Since 2026-09-30 the first reply of a plain
--   conversation is held back and checked like a debrief reply, and
--   the route recorded it as 'debrief_reply' because the surface list
--   had nothing else. Its own surface from here. Rows already written
--   are left as they are: the history says what the code did then.
--
-- No access change. The insert and select rules (0244) do not name a
-- column, so they hold the new one exactly as they hold the rest:
-- insert your own row for a company you are in, select system admins
-- only, update and delete nobody. Still no reply text, by design.
-- =============================================================

alter table public.voice_rule_breaks
  add column if not exists practice_id text;

comment on column public.voice_rule_breaks.practice_id is
  'The agent the conversation runs (coaching_conversations.practice_id); '
  'null for plain Aimee.';

alter table public.voice_rule_breaks
  drop constraint if exists voice_rule_breaks_surface_check;
alter table public.voice_rule_breaks
  add constraint voice_rule_breaks_surface_check
  check (surface in ('debrief_reply', 'opener', 'first_reply', 'conversation'));
