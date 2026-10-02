-- =============================================================
-- Migration 0255: a commitment saved from Aimee's draft, once
--
-- Part 3 of the coaching principles project (Jason, 2026-10-02). When
-- a leader says yes to drafting their next step as a commitment, Aimee
-- shows the draft as a card in the conversation, and the leader saves
-- it with a button. The save is the same create the Commitments page
-- uses (src/lib/commitments/create.ts), under the leader's own
-- session and the same insert rules.
--
-- What is new is one column: the Aimee message whose card the
-- commitment was saved from. It does two jobs.
--
--   ONCE. Unique, so a card saves one commitment however many times
--   the button is pressed, the page is reloaded, or the request is
--   sent twice. The card reads it back to show "Saved".
--
--   ONLY YOUR OWN. A trigger refuses a value that is not an Aimee
--   message in a conversation the caller started. It runs as the
--   caller, so the message has to be one their own read rules show
--   them (owner only, 0251), and it checks created_by as well, because
--   a sharee can read a conversation they did not start. Checked only
--   when the column is set or changed: an admin editing a saved
--   commitment's other columns, and every write that leaves it null
--   (the meeting pipeline, the Commitments page), never reach the
--   check.
--
-- What a reader of the commitment learns: that it came from an Aimee
-- conversation, as an id. The message itself stays readable by its
-- owner only. On delete set null: a deleted conversation leaves the
-- commitment, which is the leader's record, in place.
--
-- No access change. The insert, update and select rules on
-- commitments are untouched; the trigger only narrows.
-- =============================================================

alter table public.commitments
  add column if not exists coaching_message_id uuid
    references public.coaching_messages(id) on delete set null;

create unique index if not exists commitments_coaching_message_unique
  on public.commitments (coaching_message_id)
  where coaching_message_id is not null;

comment on column public.commitments.coaching_message_id is
  'The Aimee message whose draft card this commitment was saved from. '
  'Unique: one commitment per card. Must be an assistant message in a '
  'conversation the writer started (commitments_coaching_message_check).';

create or replace function public.commitments_coaching_message_check()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.coaching_message_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.coaching_message_id is not distinct from old.coaching_message_id then
    return new;
  end if;
  if not exists (
    select 1
      from public.coaching_messages m
      join public.coaching_conversations c on c.id = m.conversation_id
     where m.id = new.coaching_message_id
       and m.role = 'assistant'
       and c.created_by = (select auth.uid())
  ) then
    raise exception 'a commitment can only be saved from your own Aimee conversation'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists commitments_coaching_message_check on public.commitments;
create trigger commitments_coaching_message_check
  before insert or update of coaching_message_id on public.commitments
  for each row execute function public.commitments_coaching_message_check();
