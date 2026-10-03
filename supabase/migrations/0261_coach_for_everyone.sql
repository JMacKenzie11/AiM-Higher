-- =============================================================
-- Migration 0261: anyone in a company can start a coaching
-- conversation about anyone else in it
--
-- Open data, phase E (docs/investigations/open-data.md §3; Jason,
-- 2026-10-01). The Coach button was a system admin's, a company
-- admin's, or the person's direct manager's. It opens to everyone in
-- the person's company, and to an assigned guide or a portfolio admin
-- a system admin switched on as that company's admin (decision 5).
-- Other portfolio admins stay out. The conversation is still private
-- to whoever starts it (coaching_conversations_select, unchanged).
--
-- Aimee's rules for these conversations are in
-- prompts/aims-coaching-principles.md, "Coach about someone else with
-- care", which this waits on.
--
-- ONLY THE ABOUT BRANCH CHANGES. The general branch (Ask Aimee) is
-- copied exactly from 0186.
--
-- THE SUBJECT MUST BE IN THE CONVERSATION'S COMPANY. Before this, the
-- rule checked the caller against the conversation's company_id and
-- never the subject's, so a company admin could file a conversation
-- under their own company about somebody elsewhere. The app never
-- sent that; the rule now refuses it.
--
-- Harness: "coach · anyone in the company".
-- =============================================================

-- coaching_conversations_insert (INSERT) admits, always as the row's
-- created_by:
--   general  a system_admin, or anyone whose own company is the row's.
--   about    about someone else whose company is the row's company, by
--            a system_admin; anyone in that company, whatever their
--            role; or, through is_content_admin_for(), an assigned
--            aims_guide or a portfolio_admin switched on as its admin.
drop policy if exists coaching_conversations_insert on public.coaching_conversations;
create policy coaching_conversations_insert on public.coaching_conversations
for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (
    (
      mode = 'general'
      and subject_profile_id is null
      and (
        (select public.auth_role()) = 'system_admin'
        or (
          (select public.auth_company_id()) is not null
          and (select public.auth_company_id()) = coaching_conversations.company_id
        )
      )
    )
    or (
      mode = 'about'
      and subject_profile_id is not null
      and subject_profile_id <> (select auth.uid())
      and exists (
        select 1
          from public.profiles subj
         where subj.id = coaching_conversations.subject_profile_id
           and subj.company_id = coaching_conversations.company_id
      )
      and (
        (select public.auth_role()) = 'system_admin'
        or (select public.auth_company_id()) = coaching_conversations.company_id
        or public.is_content_admin_for(coaching_conversations.company_id)
      )
    )
  )
);

comment on policy coaching_conversations_insert on public.coaching_conversations is
  'General: system_admin, or the caller''s own company. About: someone else in the row''s '
  'company, by a system_admin, anyone in that company, or an assigned guide or switched-on '
  'portfolio admin via is_content_admin_for() (0261).';
