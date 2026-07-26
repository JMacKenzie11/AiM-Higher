-- =============================================================
-- Migration 0021: coaching as a platform-wide layer.
--
-- Two shifts.
--
-- 1. Explicit `mode` column on coaching_conversations. Historically
--    "who is this for" was inferred by comparing subject_profile_id
--    to created_by. That worked, but the rules now branch on mode
--    (self vs. about) and inference at query time is brittle. Add
--    the column, backfill deterministically, keep it in sync at
--    insert time.
--
-- 2. Rewritten policies:
--    - SELECT / UPDATE gated ONLY by created_by = auth.uid(). No
--      admin, no manager, and never the subject can read a
--      conversation they did not create. Self-coaching threads are
--      unreadable by everyone but their creator, including system
--      admins. This is the spec's absolute privacy rule.
--    - INSERT allows self-mode (subject = creator) for any active
--      member. About-mode requires system_admin, company_admin of
--      the subject's company, OR the subject's manager as recorded
--      in profiles.reports_to (added in migration 0017).
--
-- Feature entitlement note: the strengths module is already gated
-- per-company via the existing company_features table + the
-- `strengths` feature key (migration 0016 + companyHasFeature helper
-- in src/lib/subscriptions/service.ts). We reuse that — no new
-- `strengths_module_enabled` column is added.
-- =============================================================

-- ---- mode column + backfill ---------------------------------
alter table public.coaching_conversations
  add column if not exists mode text
    check (mode in ('self', 'about'));

-- Backfill from the historical inference rule.
update public.coaching_conversations
   set mode = case
                when subject_profile_id = created_by then 'self'
                else 'about'
              end
 where mode is null;

alter table public.coaching_conversations
  alter column mode set not null;

-- ---- Rewritten conversation policies ------------------------
drop policy if exists coaching_conversations_select on public.coaching_conversations;
drop policy if exists coaching_conversations_insert on public.coaching_conversations;
drop policy if exists coaching_conversations_update on public.coaching_conversations;

-- Absolute privacy. Only the creator can see or edit.
create policy coaching_conversations_select on public.coaching_conversations
for select to authenticated
using (created_by = auth.uid());

create policy coaching_conversations_update on public.coaching_conversations
for update to authenticated
using (created_by = auth.uid())
with check (created_by = auth.uid());

-- Create rules split by mode:
--   self  → subject_profile_id = auth.uid()  (any active member)
--   about → auth.uid() is system_admin, or company_admin of the
--           subject's company, or the subject's direct manager
--           via profiles.reports_to
create policy coaching_conversations_insert on public.coaching_conversations
for insert to authenticated
with check (
  created_by = auth.uid()
  and (
    (mode = 'self' and subject_profile_id = auth.uid())
    or (
      mode = 'about'
      and subject_profile_id <> auth.uid()
      and (
        exists (
          select 1 from public.auth_profile() ap
          where ap.role = 'system_admin'
             or (ap.role = 'company_admin'
                 and ap.company_id = public.coaching_conversations.company_id)
        )
        or exists (
          select 1 from public.profiles subj
          where subj.id = public.coaching_conversations.subject_profile_id
            and subj.reports_to = auth.uid()
        )
      )
    )
  )
);

-- ---- Message policies stay creator-only ---------------------
-- Already the case since 0015; restated so the pair is legible
-- alongside the conversation rules.
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

-- Handy index for the manager-can-create-about check.
create index if not exists profiles_reports_to_lookup_idx
  on public.profiles (reports_to)
  where reports_to is not null;
