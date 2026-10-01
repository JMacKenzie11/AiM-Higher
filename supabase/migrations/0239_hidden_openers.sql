-- =============================================================
-- Migration 0239 — coaching_messages.hidden_at, and the one way to set it
--
-- Swapping the agent on a conversation (before its first user turn)
-- is meant to replace the old agent's opener with the new one's.
-- setConversationAgentAction tried to DELETE the old assistant rows,
-- on the caller's own client. coaching_messages has no delete policy
-- ("archive only", 0012), so the delete matched nothing, silently,
-- and the old opener came back on the next load above the new one
-- (Aimee panel investigation, 2026-09-28).
--
-- Deletes stay forbidden (Jason, 2026-09-28). The opener is HIDDEN:
--
--   hidden_at            set once; null means shown
--   the select policy    no longer returns a hidden row to anybody
--                        signed in, so every reader that goes through
--                        RLS (the chat page, the chat route, the memory
--                        sweep, the list's snippets) stops seeing it
--                        without having to remember a filter
--   hide_conversation_openers(conversation)
--                        the only way to set it: SECURITY DEFINER,
--                        callable by the conversation's owner, only
--                        while the conversation has no user message,
--                        and only on assistant rows. After the first
--                        user turn nothing is hidden, ever: that is
--                        history.
--
-- Service-role readers (the analytics crons, the admin dashboard)
-- bypass RLS and filter hidden_at themselves.
--
-- MESSAGES ARE HISTORY: NO UPDATES AT ALL. 0021 gave authors an UPDATE
-- policy on their own messages, and the chat route saves Aimee's
-- replies with the conversation owner as created_by, so an owner could
-- rewrite Aimee's words through the API, or set hidden_at directly and
-- skip the function's "only before the first user turn" rule. Nothing
-- in the app updates a message (checked 2026-09-28). The policy goes,
-- and the privilege is revoked as well (E8: the verb withheld, not just
-- left without a policy). The function below is SECURITY DEFINER and
-- is unaffected; it is the only write left.
-- =============================================================

alter table public.coaching_messages
  add column if not exists hidden_at timestamptz;

drop policy if exists coaching_messages_update on public.coaching_messages;
revoke update on public.coaching_messages from authenticated;
revoke update on public.coaching_messages from anon;

comment on column public.coaching_messages.hidden_at is
  'Set when an agent swap replaced this opener, before the first user '
  'turn. Hidden rows are not returned to signed-in readers (select '
  'policy). Set only by hide_conversation_openers(); never deleted.';

-- The 0151 policy, with the hidden rows left out.
drop policy if exists coaching_messages_select on public.coaching_messages;
create policy coaching_messages_select on public.coaching_messages
for select to authenticated
using (
  hidden_at is null
  and (
    exists (
      select 1 from public.coaching_conversations cc
      where cc.id = coaching_messages.conversation_id
        and cc.created_by = auth.uid()
    )
    or public.has_coaching_share(coaching_messages.conversation_id, auth.uid())
  )
);

create or replace function public.hide_conversation_openers(p_conversation_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_hidden integer;
begin
  if auth.uid() is null then
    raise exception 'hide_conversation_openers: no signed-in user'
      using errcode = 'insufficient_privilege';
  end if;

  select created_by into v_owner
  from public.coaching_conversations
  where id = p_conversation_id;

  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'hide_conversation_openers: not your conversation'
      using errcode = 'insufficient_privilege';
  end if;

  if exists (
    select 1 from public.coaching_messages
    where conversation_id = p_conversation_id and role = 'user'
  ) then
    raise exception 'hide_conversation_openers: the conversation has started'
      using errcode = 'check_violation';
  end if;

  update public.coaching_messages
  set hidden_at = now()
  where conversation_id = p_conversation_id
    and role = 'assistant'
    and hidden_at is null;
  get diagnostics v_hidden = row_count;
  return v_hidden;
end;
$$;

revoke all on function public.hide_conversation_openers(uuid) from public;
revoke all on function public.hide_conversation_openers(uuid) from anon;
grant execute on function public.hide_conversation_openers(uuid) to authenticated;
