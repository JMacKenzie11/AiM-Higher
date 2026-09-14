-- =============================================================
-- Migration 0195: a durable watermark for coach memory
--
-- WHY. Part 2 derived "have I already summarized this conversation"
-- from coach_memories itself: the newest memory carrying that
-- conversation_ref was the high-water mark. That works exactly until
-- somebody exercises the right part 3 exists to give them.
--
-- Delete your memories, and the watermark goes with them. The next
-- sweep sees a conversation it has no record of summarizing, reads it
-- from the top, and writes the same memories back. DELETION WAS NOT
-- DURABLE — the page said the row was gone, the database agreed, and
-- the system put it back within one page load.
--
-- Caught by the part 3 E2E, which asks the question the brief
-- insisted on: does the coach still recall it in a FRESH
-- conversation. Nothing short of that run would have found it. The
-- unit tests were green, the delete worked, and the page was honest.
--
-- WHERE IT LIVES, AND WHY NOT ON coach_memories. The watermark is a
-- fact about a CONVERSATION — when it was last distilled — not about
-- a memory. Putting it on coach_memories would have meant a column on
-- the platform's most sensitive table, reopening 0194's access wall
-- and its probes, to store something that is not memory and does not
-- need protecting. coaching_conversations already carries the row's
-- own lifecycle and its owner can already update it.
--
-- It also RETIRES a known imprecision. Part 2's watermark was the
-- memory's created_at — when the summary was WRITTEN, not when the
-- last covered message arrived — so a message landing mid-summari-
-- zation could be skipped. This column is set from the timestamp of
-- the last message actually read, so that race is gone rather than
-- documented.
-- =============================================================

alter table public.coaching_conversations
  add column if not exists memory_summarized_through timestamptz;

comment on column public.coaching_conversations.memory_summarized_through is
  'Coach memory watermark: messages at or before this instant have been distilled. NOT derived from coach_memories, deliberately — deriving it there meant deleting a memory removed the watermark and the next sweep wrote the memory back, so deletion was not durable. Holds the timestamp of the last message actually read, which also retires the read-write race the derived version carried.';

-- No policy change. coaching_conversations_update already admits the
-- owner (created_by = auth.uid()), which is the only caller that
-- summarizes their own conversations, and no read path changes.
