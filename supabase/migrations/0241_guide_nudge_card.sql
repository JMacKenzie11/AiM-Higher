-- =============================================================
-- Migration 0241 — the Guide's invitation card: an invitation line
-- and Aimee's first message, written with the headline
--
-- Jason, 2026-09-29. The card in Aimee's panel shows the meeting's
-- name and date, a headline stating one strength, and a short
-- invitation line. When the champion clicks "Talk it through", Aimee's
-- first message adds what the card could not: the moment in the
-- meeting, one short quote checked against the transcript, why it
-- matters, and one question. It no longer repeats the headline.
--
-- All three are written together when the meeting's summary is done
-- (lib/guide/invitation.ts), so they are about the same moment and are
-- checked before anybody reads them. Stored here because the first
-- message is needed when the nudge is opened, which may be days later,
-- and writing it then would mean a wait on the click and a second
-- chance for it to drift from the card.
--
-- ---- WHAT THIS ROW NOW CARRIES --------------------------------
--
-- The first message holds one short quote from the meeting and a
-- sentence about a moment in it. The table comment used to promise
-- "identifiers and a headline only". Who can read the row is
-- unchanged (the recipient, the company's admins and guides, system
-- admins), and every one of them can already read the meeting, its
-- summary and, for admins, its transcript. Nothing becomes visible to
-- anybody who could not already see it.
--
-- ---- WHO CAN CHANGE IT ----------------------------------------
--
-- Unchanged: the recipient's update policy (0235) covers the whole
-- row, so they could rewrite the first message of their own debrief
-- before opening it, as they already could the headline. It only ever
-- reaches their own conversation. Rows still arrive only through the
-- admin client.
--
-- Both columns are nullable: nudges raised before this have neither,
-- and the open path falls back to the headline as the first message,
-- as it did.
-- =============================================================

alter table public.guide_nudges
  add column if not exists invitation text,
  add column if not exists opener text;

comment on column public.guide_nudges.invitation is
  'The one-line question under the headline on the card. Varied from '
  'week to week; the recent ones are read back when the next is written.';

comment on column public.guide_nudges.opener is
  'Aimee''s first message when the debrief is opened: the moment, one '
  'quote checked against the transcript, why it matters, one question. '
  'Null for nudges raised before 0241, which open on the headline.';

comment on table public.guide_nudges is
  'What the Guide raised, to whom, and what happened next. Its own '
  'memory: nothing else in the schema can derive whether a leader was '
  'invited to debrief and whether they took it up. Carries the card '
  '(headline, invitation) and Aimee''s first message, which quotes the '
  'meeting briefly; never the transcript or the analysis itself.';
