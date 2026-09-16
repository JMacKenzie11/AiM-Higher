-- A company can see, and end, a portfolio admin's assignment to it.
--
-- THIS REVERSES DECISION 5, on Jason's call (2026-09-16). That
-- decision said a company admin must never revoke a portfolio
-- admin's assignment: the portfolio owns the company, so a company
-- cannot evict its owner's operator. The reasoning was sound and the
-- premise was wrong. A portfolio admin only takes company-admin
-- rights where they intend to do the work, so in practice they are a
-- colleague on that team, and the arrangement is between people who
-- know each other by name. Building a second class of admin row to
-- defend against something nobody will do costs every reader of that
-- page a thing to understand.
--
--   "A portfolio admin is only going to be a company admin of a
--    company where they are going to play an active role anyway. So
--    their company admin role should be the same as anyone else's."
--
-- What survives from decision 5 is the shape of the ACTION rather
-- than the permission: ending the arrangement removes the assignment
-- and never the person. The roster's own Delete calls
-- auth.admin.deleteUser, which would take their account off the
-- instance entirely, and that is not what a company admin tidying
-- their team list means.
--
-- TWO POLICIES, AND THE SECOND ONE IS USELESS WITHOUT THE FIRST.
-- Failure mode E11: a `delete ... where` reads the columns it filters
-- on, so Postgres applies the SELECT policies first and the DELETE
-- policy only to what survives. Widening the delete alone would
-- change nothing at all, silently, exactly as it did on
-- guide_assignments in 0201.

-- ---------------------------------------------------------------
-- 1. SELECT — and this one also finishes a job 0204 left half done.
-- ---------------------------------------------------------------
--
-- getAssignablePeople (0204) reads portfolio_assignments through the
-- caller's own client to find who is assigned to a company. For a
-- company_admin that read has been returning zero rows, because the
-- policy below admitted only the system_admin and the assignment's
-- own holder. The guide half of that picker worked — 0201 widened
-- guide_assignments_select — and the portfolio half quietly did not.
-- Same bug as the `role = 'system_admin'` coach list it replaced,
-- shipped in the change that fixed it.
drop policy if exists portfolio_assignments_select on public.portfolio_assignments;
create policy portfolio_assignments_select on public.portfolio_assignments
for select to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or ap.uid = public.portfolio_assignments.portfolio_admin_id
       -- Anyone in the company the assignment names. Not only its
       -- admins: the roster and the owner picker render for every
       -- member, and a list whose contents depend on the viewer is
       -- worse than no list.
       or (ap.company_id is not null
           and ap.company_id = public.portfolio_assignments.company_id)
  )
);

-- ---------------------------------------------------------------
-- 2. DELETE — the company admin, and nobody further down.
-- ---------------------------------------------------------------
--
-- company_admin only. A team member who can SEE the assignment
-- cannot end it, which is the same line the roster draws for every
-- other management action on that page.
drop policy if exists portfolio_assignments_delete on public.portfolio_assignments;
create policy portfolio_assignments_delete on public.portfolio_assignments
for delete to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'portfolio_admin'
           and ap.uid = public.portfolio_assignments.portfolio_admin_id)
       or (ap.role = 'company_admin'
           and ap.company_id is not null
           and ap.company_id = public.portfolio_assignments.company_id)
  )
);

comment on policy portfolio_assignments_delete on public.portfolio_assignments is
  'The system admin, the holder themselves, or a company_admin of the '
  'company the assignment names. The last of those reverses decision '
  '5: a company may end the arrangement, and ending it removes the '
  'assignment rather than the person.';
