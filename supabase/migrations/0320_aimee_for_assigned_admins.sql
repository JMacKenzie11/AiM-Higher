-- 0320: an assigned guide, or a portfolio admin switched on as a
-- company's admin, can start an Ask Aimee conversation there.
--
-- WHY. Jason, 2026-11-03. Steve Kessen, a portfolio admin switched on
-- as Promise One's company admin, opened Ask Aimee there and got "new
-- row violates row-level security policy for table
-- coaching_conversations". 0261 opened the ABOUT branch (Coach about
-- someone) to is_content_admin_for(), and copied the GENERAL branch
-- (Ask Aimee, and every agent, which runs in general mode) from 0186
-- unchanged: a system admin, or the caller's own company. A portfolio
-- admin or guide has no own company, so in a company they are assigned
-- to, they could coach about a colleague but could not ask Aimee
-- anything, or start the Vivid Vision Coach.
--
-- WHAT. The general branch gains is_content_admin_for(company_id), the
-- same predicate the about branch already uses: an assigned aims_guide,
-- or a portfolio_admin a system admin switched on as that company's
-- admin (0245). Nothing else changes, word for word from 0261. The
-- conversation stays private to whoever starts it
-- (coaching_conversations_select, unchanged). A portfolio admin who is
-- not switched on stays out, as 0261 decided for the about branch.
--
-- Harness: "ask aimee · assigned admins", red before 0320.

-- coaching_conversations_insert (INSERT) admits, always as the row's
-- created_by:
--   general  a system_admin; anyone whose own company is the row's; or,
--            through is_content_admin_for(), an assigned aims_guide or
--            a portfolio_admin switched on as its admin (0320).
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
        or public.is_content_admin_for(coaching_conversations.company_id)
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
  'General: system_admin, the caller''s own company, or an assigned guide or switched-on '
  'portfolio admin via is_content_admin_for() (0320). About: someone else in the row''s '
  'company, by a system_admin, anyone in that company, or an assigned guide or switched-on '
  'portfolio admin via is_content_admin_for() (0261).';
