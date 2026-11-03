-- 0319: people assigned to a company can see each other.
--
-- WHY. Jason, 2026-11-03. On promiseone, Steve Kessen (a portfolio
-- admin assigned to Promise One and switched on as its company admin)
-- could only pick himself as a commitment's owner. Promise One's whole
-- team is three portfolio admins, all assigned, none with a company of
-- their own. 0204 lets a company read the people assigned to it, but
-- only for a viewer who BELONGS to the company (auth_company_id), and
-- a portfolio admin or guide belongs to none. So each of them saw the
-- company's members (0191, and 0111 for guides) and not one another.
-- The People page looked right to a system admin and wrong to them.
--
-- WHAT. A read and nothing else: a person holding an assignment to a
-- company, as a guide (guide_assignments) or a portfolio admin
-- (portfolio_assignments), may read the profiles of the others
-- assigned to that same company. Not to any other company. Not anyone
-- with no assignment. No write: 0004's update rules are untouched.
-- The acts-as-company-admin switch (0245) is untouched too: this
-- decides who can SEE a colleague's name, never who may act.
--
-- Through a definer helper, for 0204's reason: a policy's subqueries
-- run as the caller, and portfolio_assignments' select admits only
-- the system admin and the row's own holder, so an inline EXISTS
-- asking about a colleague's assignment would read an empty table.
--
-- Harness probe "profiles · assigned see assigned": red before 0319,
-- green with it.

-- Does the caller hold an assignment to some company that this person
-- is also assigned to? Allowed callers: any signed-in person; it is
-- only ever true for an assigned guide or portfolio admin.
create or replace function public.shares_assignment_with(target_profile_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
      from (
        select ga.company_id from public.guide_assignments ga
         where ga.guide_id = (select auth.uid())
        union
        select pa.company_id from public.portfolio_assignments pa
         where pa.portfolio_admin_id = (select auth.uid())
      ) mine
     where public.is_assigned_to_company(target_profile_id, mine.company_id)
  )
$$;

revoke all on function public.shares_assignment_with(uuid) from public;
grant execute on function public.shares_assignment_with(uuid) to authenticated;

comment on function public.shares_assignment_with(uuid) is
  'Is this person assigned to a company the caller is also assigned to? '
  'Definer, as is_assigned_to_company (0204). Returns a boolean only. '
  'See 0319.';

-- Read only. Roles it admits: an assigned aims_guide or portfolio_admin
-- (system_admin already reads every profile), for colleagues assigned
-- to the same company. Permissive, so it only adds.
drop policy if exists profiles_select_coassigned on public.profiles;
create policy profiles_select_coassigned on public.profiles
for select to authenticated
using (public.shares_assignment_with(public.profiles.id));

comment on policy profiles_select_coassigned on public.profiles is
  'People assigned to a company (guides, portfolio admins) read the '
  'others assigned to it. Read only. See 0319.';
