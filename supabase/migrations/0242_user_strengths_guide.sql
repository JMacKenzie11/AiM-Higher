-- =============================================================
-- Migration 0242: an assigned aims_guide edits a person's Strengths.
--
-- THE DECISION. An aims_guide on an assigned company has the same
-- powers as that company's company_admin (Jason, 2026-09-29). That
-- includes the manual Strengths and Superpowers on a person's
-- profile: the inline editor on /people/[id], the page at
-- /people/[id]/strengths, and saveUserStrengthsAction behind both.
--
-- WHY IT NEEDS A MIGRATION. 0111 left user_strengths out of the guide
-- mirrors on purpose ("personal / private surfaces"), and 0188's four
-- policies admit system_admin, the subject, and the subject's
-- company_admin. Nothing admits a guide, for any verb. Widening the
-- action alone is failure mode E5: a control that renders and fails
-- on every save.
--
-- ALL FOUR VERBS, SELECT INCLUDED. The action saves by replace-all:
-- delete the subject's rows, insert the new set. A DELETE has to read
-- the rows it filters on, so the SELECT policy is part of the write
-- path (E11). A guide cannot see these rows today, so a delete-only
-- grant would delete nothing and the insert would then duplicate.
-- The read is also what the editor loads its current values from.
--
-- SHAPE. Separate _guide policies beside 0188's, mirroring its
-- company_admin branch exactly: a role test first, evaluated once,
-- then the correlated lookup of the SUBJECT's company. Where 0188
-- compares that company to auth_company_id(), this asks whether the
-- caller is assigned to it. user_strengths has no company_id of its
-- own; the subject's profile is the only route to one, and 0188's
-- header explains why the FK makes that lookup safe.
--
-- WHY is_assigned_guide_for() AND NOT is_guide_for(). Since 0199,
-- is_guide_for() wraps is_admin_for(), which also admits a
-- portfolio_admin through portfolio_assignments. CLAUDE.md closes the
-- list of tables where portfolio_admin may hold a write policy at
-- four, and user_strengths is not one of them. 0221 added
-- is_assigned_guide_for() for exactly this: the guide test without
-- the portfolio arm. Used on the SELECT as well, for one predicate
-- across the four; a portfolio_admin already reads these rows
-- through user_strengths_select_portfolio (0191).
--
-- WHAT IS NOT WIDENED. A team_member still writes only their own
-- rows. A guide reaches only companies they are assigned to. The
-- harness probe `user_strengths guide grant` asserts both, and an
-- assigned portfolio_admin's refusal, as the same run.
-- =============================================================

drop policy if exists user_strengths_select_guide on public.user_strengths;
create policy user_strengths_select_guide on public.user_strengths
for select to authenticated
using (
  (select public.auth_role()) = 'aims_guide'
  and exists (
    select 1 from public.profiles p
    where p.id = public.user_strengths.user_id
      and p.company_id is not null
      and public.is_assigned_guide_for(p.company_id)
  )
);

drop policy if exists user_strengths_insert_guide on public.user_strengths;
create policy user_strengths_insert_guide on public.user_strengths
for insert to authenticated
with check (
  (select public.auth_role()) = 'aims_guide'
  and exists (
    select 1 from public.profiles p
    where p.id = public.user_strengths.user_id
      and p.company_id is not null
      and public.is_assigned_guide_for(p.company_id)
  )
);

drop policy if exists user_strengths_update_guide on public.user_strengths;
create policy user_strengths_update_guide on public.user_strengths
for update to authenticated
using (
  (select public.auth_role()) = 'aims_guide'
  and exists (
    select 1 from public.profiles p
    where p.id = public.user_strengths.user_id
      and p.company_id is not null
      and public.is_assigned_guide_for(p.company_id)
  )
)
with check (
  (select public.auth_role()) = 'aims_guide'
  and exists (
    select 1 from public.profiles p
    where p.id = public.user_strengths.user_id
      and p.company_id is not null
      and public.is_assigned_guide_for(p.company_id)
  )
);

drop policy if exists user_strengths_delete_guide on public.user_strengths;
create policy user_strengths_delete_guide on public.user_strengths
for delete to authenticated
using (
  (select public.auth_role()) = 'aims_guide'
  and exists (
    select 1 from public.profiles p
    where p.id = public.user_strengths.user_id
      and p.company_id is not null
      and public.is_assigned_guide_for(p.company_id)
  )
);
