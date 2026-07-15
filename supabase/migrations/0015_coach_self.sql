-- =============================================================
-- Phase 6 — Migration 0015: allow self-coaching.
--
-- Team members can now create coaching conversations about
-- themselves. The rule expands from "admin only" to "admin OR (the
-- subject is you and you own the row)." Admin-about-another-admin
-- and admin-about-team-member paths are unchanged.
--
-- Message policies simplify at the same time: instead of duplicating
-- the role check on every message row, we just require that the
-- parent conversation is accessible (RLS on that table already
-- enforces the correct rule). Cleaner and keeps message policies in
-- sync automatically if the conversation rule changes again.
-- =============================================================

drop policy if exists coaching_conversations_select on public.coaching_conversations;
drop policy if exists coaching_conversations_insert on public.coaching_conversations;
drop policy if exists coaching_conversations_update on public.coaching_conversations;

create policy coaching_conversations_select on public.coaching_conversations
for select to authenticated
using (
  created_by = auth.uid()
  and (
    exists (
      select 1 from public.auth_profile() ap
      where ap.role in ('company_admin','system_admin')
        and (
          ap.role = 'system_admin'
          or ap.company_id = public.coaching_conversations.company_id
        )
    )
    or subject_profile_id = auth.uid()
  )
);

create policy coaching_conversations_insert on public.coaching_conversations
for insert to authenticated
with check (
  created_by = auth.uid()
  and (
    exists (
      select 1 from public.auth_profile() ap
      where ap.role in ('company_admin','system_admin')
        and (
          ap.role = 'system_admin'
          or ap.company_id = public.coaching_conversations.company_id
        )
    )
    or subject_profile_id = auth.uid()
  )
);

create policy coaching_conversations_update on public.coaching_conversations
for update to authenticated
using (
  created_by = auth.uid()
  and (
    exists (
      select 1 from public.auth_profile() ap
      where ap.role in ('company_admin','system_admin')
        and (
          ap.role = 'system_admin'
          or ap.company_id = public.coaching_conversations.company_id
        )
    )
    or subject_profile_id = auth.uid()
  )
)
with check (
  created_by = auth.uid()
);

-- Messages: rely on the parent conversation's RLS. Simpler and
-- automatically inherits any future changes to the rule above.
drop policy if exists coaching_messages_select on public.coaching_messages;
drop policy if exists coaching_messages_insert on public.coaching_messages;
drop policy if exists coaching_messages_update on public.coaching_messages;

create policy coaching_messages_select on public.coaching_messages
for select to authenticated
using (
  created_by = auth.uid()
  and exists (
    select 1 from public.coaching_conversations cc
    where cc.id = public.coaching_messages.conversation_id
      and cc.created_by = auth.uid()
  )
);

create policy coaching_messages_insert on public.coaching_messages
for insert to authenticated
with check (
  created_by = auth.uid()
  and exists (
    select 1 from public.coaching_conversations cc
    where cc.id = public.coaching_messages.conversation_id
      and cc.created_by = auth.uid()
  )
);

create policy coaching_messages_update on public.coaching_messages
for update to authenticated
using (created_by = auth.uid())
with check (created_by = auth.uid());
