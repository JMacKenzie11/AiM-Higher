-- Assigned access: the card on a company's admin page listing the
-- people who administer it without being part of its team.
--
-- Product spec §1a, decision 9. This supersedes decisions 6 and 8:
-- these people were going to join the /people roster with a
-- provenance badge, and they do not. /people is the team's page and
-- everybody in the company reads it; the people who need to know
-- about outside access are the ones who administer the company, and
-- they already have a page.
--
-- TWO CHANGES. One is a read the card could not otherwise do, and one
-- is a genuine role widening against live rows.

-- ---------------------------------------------------------------
-- 1. assigned_access() — the card's read.
-- ---------------------------------------------------------------
--
-- WHY A DEFINER FUNCTION RATHER THAN WIDER POLICIES. The card needs
-- three things a company admin cannot read today, and the shortest
-- path to each is a policy this change should not be touching:
--
--   guide_assignments_select      system_admin or the guide themselves
--   portfolio_assignments_select  system_admin or the holder (0199)
--   profiles_select               system_admin, same company, or self
--
-- The last one is the problem. An assigned guide's profile has
-- company_id null, so a company admin cannot read their name — and
-- widening profiles_select to fix a card means editing the policy
-- that decides who can read a person anywhere in the product, on
-- behalf of the least important surface in this change.
--
-- This function is the narrow alternative. It is SECURITY DEFINER, so
-- it sees the three tables regardless of the caller, and it returns
-- exactly two columns about exactly the people assigned to one
-- company. Nothing else leaks, because nothing else is selected.
--
-- The guard is the first thing it does, and it returns EMPTY rather
-- than raising: an unauthorised caller gets the same answer as a
-- company with nobody assigned, which is the honest answer to "who
-- has outside access here" from somebody who may not ask.
--
-- aims_guide is deliberately absent from the guard. A guide reaches
-- this page for companies they are assigned to, and decision 9 keeps
-- the card off it: their own assignments are already in Guide HQ, and
-- this is a surface for the people who administer the company rather
-- than the people assigned to it.
create or replace function public.assigned_access(target_company_id uuid)
returns table (profile_id uuid, full_name text, kind text)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or ap.role = 'portfolio_admin'
       or (ap.role = 'company_admin' and ap.company_id = target_company_id)
  ) then
    return;
  end if;

  return query
    select p.id, p.full_name, 'guide'::text
      from public.guide_assignments ga
      join public.profiles p on p.id = ga.guide_id
     where ga.company_id = target_company_id
    union all
    select p.id, p.full_name, 'portfolio'::text
      from public.portfolio_assignments pa
      join public.profiles p on p.id = pa.portfolio_admin_id
     where pa.company_id = target_company_id
     order by 3, 2;
end;
$$;

revoke all on function public.assigned_access(uuid) from public;
grant execute on function public.assigned_access(uuid) to authenticated;

comment on function public.assigned_access(uuid) is
  'Who administers this company without being part of its team. '
  'Returns empty for anyone but a system_admin, a portfolio_admin, or '
  'the company_admin of the company asked about. Definer so the card '
  'can name an assigned guide without widening profiles_select.';

-- ---------------------------------------------------------------
-- 2. guide_assignments_delete — decision 7, and a real widening.
-- ---------------------------------------------------------------
--
-- A company admin may end a guide's engagement without asking
-- anybody. The reason is about the relationship rather than about
-- consistency: a guide may stop working with a company that carries
-- on using AiMS HQ. The engagement ends and the product does not.
--
-- THIS CHANGES LIVE BEHAVIOUR. There are 17 assignment rows across
-- two real guides, and from this migration their companies can remove
-- them. That is the intent, and it is why this is the only piece of
-- the portfolio sequence that is not additive.
--
-- The opposite case is portfolio_assignments, and 0199 already says
-- so: the portfolio owns the company, so a company cannot evict its
-- owner's operator. Decision 5. Nothing below admits company_admin
-- there, and the harness asserts that it stays that way.
--
-- portfolio_admin is NOT added here. It is not on the closed write
-- list for this role (companies, company_features, profiles,
-- portfolio_admin_events, portfolio_assignments), the harness fails
-- on any write policy naming the role outside it, and nothing has
-- asked for it.
-- THE SELECT POLICY IS PART OF THE DELETE, and that is not a
-- figure of speech. A `delete ... where guide_id = $1 and company_id
-- = $2` has to READ those columns to find its rows, so Postgres
-- applies the SELECT policy first and the DELETE policy only to what
-- survives it. guide_assignments_select admits the system_admin and
-- the guide themselves, so a company admin could not see the row and
-- therefore could not delete it — with a DELETE policy that named
-- them explicitly and was, in isolation, correct.
--
-- This was caught by the harness and not by reading the SQL. The
-- probe reported the row still present, which reads exactly like a
-- policy refusing, and the policy was the first thing to be
-- suspected. Measured, both statements are needed:
--
--   delete policy only     rows remaining = 1
--   delete + select policy rows remaining = 0
--
-- A permanent claim on guide-assignment-revocation now asserts the
-- visibility directly, so a future narrowing of this SELECT breaks
-- the read claim rather than silently disarming the revocation.
-- Written up as failure mode E11.
--
-- The widening is also what the company admin is owed on its own
-- terms: these are the guides assigned to their company, and the
-- assigned-access card exists to show them.
drop policy if exists guide_assignments_select on public.guide_assignments;
create policy guide_assignments_select on public.guide_assignments
for select to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (select auth.uid()) = public.guide_assignments.guide_id
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) is not null
    and (select public.auth_company_id()) = public.guide_assignments.company_id
  )
);

drop policy if exists guide_assignments_delete on public.guide_assignments;
create policy guide_assignments_delete on public.guide_assignments
for delete to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) is not null
    and (select public.auth_company_id()) = public.guide_assignments.company_id
  )
);
