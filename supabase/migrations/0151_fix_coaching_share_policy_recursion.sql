-- =============================================================
-- Migration 0151: fix RLS recursion between coaching_conversations
-- and coaching_conversation_shares (regression from 0150).
--
-- What broke
-- ----------
-- Migration 0150 introduced cross-referencing SELECT policies:
--   * coaching_conversations SELECT: owner OR EXISTS(shares)
--   * coaching_conversation_shares SELECT: own-row OR EXISTS(conv where owner)
--
-- Semantically each pair terminates — the EXISTS subqueries always
-- constrain their scan to rows that satisfy the "other" policy's
-- short-circuit branch — but Postgres detects the cross-table
-- policy reference and refuses to plan certain queries, most
-- visibly the .insert(...).select("*") pattern after
-- createPracticeConversation inserts a row and reads it back.
-- The user-visible symptom is "Couldn't start that practice."
-- and every existing conversation appearing to have disappeared
-- from the /ask-aimee list.
--
-- Fix
-- ---
-- Break the cycle with two SECURITY DEFINER helpers that read the
-- underlying tables with RLS bypassed. Each policy then calls the
-- helper for the "other" table's check instead of a nested EXISTS.
-- No cross-policy reference remains, so no recursion.
--
-- Helper functions never widen access on their own — the policies
-- still contain the auth.uid() check. They just move the row
-- lookup outside RLS so Postgres doesn't re-enter another policy.
-- =============================================================

-- ---- Helpers ------------------------------------------------
create or replace function public.is_coaching_conversation_owner(
  target_conversation_id uuid,
  candidate_user_id uuid
)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.coaching_conversations cc
    where cc.id = target_conversation_id
      and cc.created_by = candidate_user_id
  );
$$;

revoke all on function public.is_coaching_conversation_owner(uuid, uuid) from public;
grant execute on function public.is_coaching_conversation_owner(uuid, uuid)
  to authenticated, anon;

create or replace function public.has_coaching_share(
  target_conversation_id uuid,
  candidate_user_id uuid
)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.coaching_conversation_shares s
    where s.conversation_id = target_conversation_id
      and s.profile_id = candidate_user_id
  );
$$;

revoke all on function public.has_coaching_share(uuid, uuid) from public;
grant execute on function public.has_coaching_share(uuid, uuid)
  to authenticated, anon;

create or replace function public.has_coaching_write_share(
  target_conversation_id uuid,
  candidate_user_id uuid
)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.coaching_conversation_shares s
    where s.conversation_id = target_conversation_id
      and s.profile_id = candidate_user_id
      and s.access = 'write'
  );
$$;

revoke all on function public.has_coaching_write_share(uuid, uuid) from public;
grant execute on function public.has_coaching_write_share(uuid, uuid)
  to authenticated, anon;

-- ---- Rewrite coaching_conversations SELECT ------------------
-- No longer references shares directly; delegates the share check
-- to the SECURITY DEFINER helper.
drop policy if exists coaching_conversations_select on public.coaching_conversations;

create policy coaching_conversations_select on public.coaching_conversations
for select to authenticated
using (
  created_by = auth.uid()
  or public.has_coaching_share(coaching_conversations.id, auth.uid())
);

-- ---- Rewrite coaching_conversation_shares SELECT ------------
-- No longer references conversations directly; delegates the owner
-- check to the SECURITY DEFINER helper.
drop policy if exists coaching_conversation_shares_select on public.coaching_conversation_shares;

create policy coaching_conversation_shares_select
on public.coaching_conversation_shares
for select to authenticated
using (
  profile_id = auth.uid()
  or public.is_coaching_conversation_owner(
       coaching_conversation_shares.conversation_id,
       auth.uid()
     )
);

-- ---- Rewrite coaching_conversation_shares INSERT ------------
-- Same fix on the write path: owner check via helper. The
-- same-company invariant stays enforced by the trigger.
drop policy if exists coaching_conversation_shares_insert on public.coaching_conversation_shares;

create policy coaching_conversation_shares_insert
on public.coaching_conversation_shares
for insert to authenticated
with check (
  created_by = auth.uid()
  and public.is_coaching_conversation_owner(
        coaching_conversation_shares.conversation_id,
        auth.uid()
      )
);

-- ---- Rewrite coaching_conversation_shares UPDATE ------------
drop policy if exists coaching_conversation_shares_update on public.coaching_conversation_shares;

create policy coaching_conversation_shares_update
on public.coaching_conversation_shares
for update to authenticated
using (
  public.is_coaching_conversation_owner(
    coaching_conversation_shares.conversation_id,
    auth.uid()
  )
)
with check (
  public.is_coaching_conversation_owner(
    coaching_conversation_shares.conversation_id,
    auth.uid()
  )
);

-- ---- Rewrite coaching_conversation_shares DELETE ------------
drop policy if exists coaching_conversation_shares_delete on public.coaching_conversation_shares;

create policy coaching_conversation_shares_delete
on public.coaching_conversation_shares
for delete to authenticated
using (
  profile_id = auth.uid()
  or public.is_coaching_conversation_owner(
       coaching_conversation_shares.conversation_id,
       auth.uid()
     )
);

-- ---- Rewrite coaching_messages SELECT + INSERT --------------
-- Both policies previously nested EXISTS on shares within an EXISTS
-- on conversations. Collapse to a single helper call for the share
-- branch so the policy is a flat OR without cross-table subqueries.
drop policy if exists coaching_messages_select on public.coaching_messages;
drop policy if exists coaching_messages_insert on public.coaching_messages;

create policy coaching_messages_select on public.coaching_messages
for select to authenticated
using (
  exists (
    select 1 from public.coaching_conversations cc
    where cc.id = coaching_messages.conversation_id
      and cc.created_by = auth.uid()
  )
  or public.has_coaching_share(coaching_messages.conversation_id, auth.uid())
);

create policy coaching_messages_insert on public.coaching_messages
for insert to authenticated
with check (
  created_by = auth.uid()
  and (
    exists (
      select 1 from public.coaching_conversations cc
      where cc.id = coaching_messages.conversation_id
        and cc.created_by = auth.uid()
    )
    or public.has_coaching_write_share(coaching_messages.conversation_id, auth.uid())
  )
);
