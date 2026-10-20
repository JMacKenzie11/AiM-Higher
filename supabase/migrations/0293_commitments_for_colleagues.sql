-- 0293: anyone in a company may add a commitment for someone else in it.
--
-- WHY. Jason, 2026-10-20: "I'd actually like people to be able to add
-- commitments for other people." Until now only an admin could name
-- another owner; everyone else's new commitment was their own
-- (commitments_insert_owner, 0177 and 0246). In a meeting one person
-- often writes down what a colleague just took on.
--
-- WHAT. One more INSERT policy, commitments_insert_for_colleague. The
-- row must be in the writer's own company, and its owner must be on
-- that company's roster: one of its active people, or a guide or
-- portfolio admin assigned to it (is_assigned_to_company, 0204), the
-- same list the Owner picker offers (lib/people/assignable.ts). Who
-- added it is stamped as created_by (0225's trigger).
--
-- What it does NOT change. Only adding: once saved, the commitment is
-- its owner's, and editing, resolving or deleting it stays with the
-- owner and the admins, as before. A portfolio admin, whose company_id
-- is null by constraint, is not admitted here: its writes stay the
-- closed list (CLAUDE.md, Permissions), and where a system admin has
-- switched it on as a company's admin it already has that through
-- commitments_insert_guide (0245).
--
-- Harness probe "commitments · for a colleague".

-- Roles: any member of the company (any role whose company_id is the
-- row's company), for an owner on that company's roster. Never a
-- portfolio_admin (no company_id), never another company's row.
drop policy if exists commitments_insert_for_colleague on public.commitments;
create policy commitments_insert_for_colleague on public.commitments
for insert to authenticated
with check (
  (select public.auth_company_id()) is not null
  and (select public.auth_company_id()) = public.commitments.company_id
  and public.commitments.owner_id is not null
  and (
    exists (
      select 1 from public.profiles p
      where p.id = public.commitments.owner_id
        and p.company_id = public.commitments.company_id
        and p.status <> 'inactive'
    )
    or public.is_assigned_to_company(public.commitments.owner_id, public.commitments.company_id)
  )
);

comment on policy commitments_insert_for_colleague on public.commitments is
  'Admits: a member of the company, adding a commitment owned by someone on its roster (an active person in it, or an assigned guide or portfolio admin). Insert only (0293).';
