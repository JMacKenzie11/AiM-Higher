-- The people assigned to your company are readable by your company.
--
-- THE HOLE THIS FILLS, MEASURED ON THE DEV CLONE as a real
-- company_admin of a company that has a guide assigned to it:
--
--   system admins visible ....... 0
--   their assigned guide visible. 0
--   profiles visible ............ 6   (their own company, exactly)
--
-- profiles_select admits a system_admin, a member of the same
-- company, or yourself. profiles_select_guide and
-- profiles_select_portfolio widen it for those two roles looking IN.
-- Nothing widens it for a company looking OUT at the people working
-- with them, and an assigned guide or portfolio admin has a NULL
-- company_id, so they fall outside every clause.
--
-- WHAT THAT BROKE QUIETLY. getCommitmentsPanel appends system_admin
-- profiles to the owner picker "so a coach can be selected as owner".
-- For a company_admin that query has always returned zero rows: the
-- feature works when a system admin is looking at it and for nobody
-- else. It reads as a feature and behaves as an empty list.
--
-- SCOPED TO ASSIGNMENTS, NOT TO PLATFORM ROLES. This does not say
-- "company users may read guides". It says "may read the people
-- assigned to MY company", which is a row in guide_assignments or
-- portfolio_assignments naming both sides. No assignment, no read —
-- so a company cannot enumerate the instance's staff, and a guide who
-- stops working with a company stops being visible to it the moment
-- the assignment goes.
--
-- WHY EVERY MEMBER AND NOT ONLY ADMINS. The point of the read is that
-- these people appear in owner pickers and, for portfolio admins, in
-- the roster. A team member opening /commitments renders the same
-- dropdown, so restricting this to admins would produce a list whose
-- contents depend on who is looking.
--
-- auth_company_id() is NULL for every cross-company role, and a NULL
-- compares equal to nothing, so this grants those roles nothing. The
-- `is not null` guard says so out loud rather than relying on it.
-- A POLICY'S SUBQUERIES ARE THEMSELVES SUBJECT TO RLS, and that is
-- the reason this goes through a definer function rather than two
-- inline EXISTS clauses. The first version asked the question
-- directly:
--
--   exists (select 1 from public.portfolio_assignments pa
--            where pa.portfolio_admin_id = public.profiles.id ...)
--
-- That subquery runs as the caller, so portfolio_assignments_select
-- decides what it can see — and that policy (0199) admits the
-- system_admin and the assignment's own holder, nobody else. A
-- company admin asking "is this person assigned to me" was reading an
-- empty table and correctly concluding no. The same went for a team
-- member and guide_assignments, whose SELECT admits company admins
-- (0201) and not members.
--
-- Measured, with everything else identical:
--
--   inline EXISTS     assigned guide 1, assigned PA 0, seen by member 0
--   definer helper    assigned guide 1, assigned PA 1, seen by member 1
--
-- The alternative was to widen the SELECT on both assignment tables
-- so that every company user could read them, which grants far more
-- than the question needs. A definer function answers the one
-- question and returns a boolean. Failure mode E11's near relative:
-- a predicate that is correct and cannot see what it is asking about.
create or replace function public.is_assigned_to_company(
  target_profile_id uuid,
  target_company_id uuid
)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.guide_assignments ga
    where ga.guide_id = target_profile_id
      and ga.company_id = target_company_id
  ) or exists (
    select 1 from public.portfolio_assignments pa
    where pa.portfolio_admin_id = target_profile_id
      and pa.company_id = target_company_id
  )
$$;

revoke all on function public.is_assigned_to_company(uuid, uuid) from public;
grant execute on function public.is_assigned_to_company(uuid, uuid) to authenticated;

comment on function public.is_assigned_to_company(uuid, uuid) is
  'Does this person hold an assignment to this company, as a guide or '
  'as a portfolio admin? Definer, because a policy that asks this '
  'inline reads the assignment tables as the caller and gets an empty '
  'answer. Returns a boolean and nothing else.';

create policy profiles_select_assigned on public.profiles
for select to authenticated
using (
  (select public.auth_company_id()) is not null
  and public.is_assigned_to_company(
    public.profiles.id,
    (select public.auth_company_id())
  )
);

comment on policy profiles_select_assigned on public.profiles is
  'A company may read the profiles of people assigned to it: guides '
  'via guide_assignments, portfolio admins via portfolio_assignments. '
  'Permissive, so it only ever adds. Read only: nothing here lets a '
  'company write to a profile it does not own.';
