-- =============================================================
-- Migration 0105: Ask Aimee — general coaching, retire self-coaching.
--
-- Two shifts.
--
-- 1. `mode` is now ('about','general'). Self-coaching disappears.
--    Existing 'self' rows migrate to 'general' with subject cleared
--    so they surface in their creator's Ask Aimee list.
--
-- 2. `subject_profile_id` becomes nullable — general conversations
--    have no on-file subject. The user brings the situation.
--
-- Order matters: relax the NOT NULL and rewrite the check constraint
-- BEFORE dropping insert policies (the insert policy references
-- mode='self' and would block the data migration otherwise). Data
-- migration itself runs as service-role (Supabase runs migrations
-- with the postgres role, which bypasses RLS).
-- =============================================================

-- ---- Allow null subject on general conversations ------------
alter table public.coaching_conversations
  alter column subject_profile_id drop not null;

-- ---- Swap the check constraint to ('about','general') -------
-- Drop the old check first so we can update 'self' rows in-place
-- without violating either constraint transiently.
alter table public.coaching_conversations
  drop constraint if exists coaching_conversations_mode_check;

-- Migrate existing 'self' rows to 'general' + null subject. Titles
-- and messages are preserved. Privacy is unchanged because RLS still
-- gates on created_by = auth.uid().
update public.coaching_conversations
   set mode = 'general',
       subject_profile_id = null
 where mode = 'self';

alter table public.coaching_conversations
  add constraint coaching_conversations_mode_check
    check (mode in ('about', 'general'));

-- ---- Row shape sanity: general has no subject; about does ---
alter table public.coaching_conversations
  drop constraint if exists coaching_conversations_subject_shape;

alter table public.coaching_conversations
  add constraint coaching_conversations_subject_shape check (
    (mode = 'about'   and subject_profile_id is not null)
    or (mode = 'general' and subject_profile_id is null)
  );

-- ---- Rewritten insert policy --------------------------------
-- SELECT / UPDATE stay strictly `created_by = auth.uid()` (defined
-- in migration 0021) — general conversations remain invisible to
-- everyone but their creator, system admins included.
drop policy if exists coaching_conversations_insert on public.coaching_conversations;

-- Create rules:
--   general → subject is null; any active member of the same company
--             (or a system_admin operating on any company) may create
--   about   → subject <> creator; caller is system_admin, company_admin
--             of the subject's company, or the subject's direct
--             manager via profiles.reports_to
create policy coaching_conversations_insert on public.coaching_conversations
for insert to authenticated
with check (
  created_by = auth.uid()
  and (
    (
      mode = 'general'
      and subject_profile_id is null
      and exists (
        select 1 from public.auth_profile() ap
        where ap.role = 'system_admin'
           or (ap.company_id is not null
               and ap.company_id = public.coaching_conversations.company_id)
      )
    )
    or (
      mode = 'about'
      and subject_profile_id is not null
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

-- ---- Index for the Ask Aimee list --------------------------
create index if not exists coaching_conversations_general_by_creator_idx
  on public.coaching_conversations (created_by, updated_at desc)
  where mode = 'general' and archived = false;
