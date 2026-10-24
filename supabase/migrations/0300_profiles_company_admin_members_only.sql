-- 0300: a company's admins manage its members, never a guide's account.
--
-- WHY. Jason, 2026-10-24: a guide may also run their own coaching
-- company, sold to coaches who manage their own business and guide
-- their clients. A system admin gives the guide that company: the
-- guide's profile takes it as its company_id, so they are on its
-- chart, own its work and sit in its meetings, and a guide assignment
-- to it makes them its admin. Their role stays aims_guide, which is
-- what keeps their clients.
--
-- Until now no aims_guide had a company_id, so four policies never
-- met one. Each admits a company's admin, or a guide assigned to it,
-- to change or delete the company's profiles, and each checks the
-- row's company and nothing about the row's role:
--
--   profiles_update_company_admin   (0187) the WITH CHECK keeps the
--     NEW role to company_admin or team_member, which stops a promotion
--     and allows a demotion: the guide becomes a team member and
--     loses every client
--   profiles_update_guide           (0164) the same, for another guide
--     assigned to the coach's company
--   profiles_delete                 (0187) the company_admin branch
--   profiles_delete_guide           (0111) the same, for a guide
--
-- The guide's account reaches every client they coach, so the people
-- who manage it are the guide and a system admin. Never a company's
-- admin because the guide is a member there.
--
-- WHAT. Each of the four now also requires the EXISTING row's role to
-- be company_admin or team_member (in USING, which is what a delete
-- and the row an update starts from are tested against). Every other
-- branch is transcribed unchanged. Profiles with those roles are
-- managed exactly as before, and no profile with another role had a
-- company until now, so nothing anybody does today changes.
--
-- Harness probe "a guide's own company · admins manage members only":
-- the company's admin and another assigned guide edit a member and are
-- refused the guide's account; the guide administers their own
-- company.

-- Roles: system_admin may delete any profile; company_admin may
-- delete a company_admin or team_member in its own company, never
-- itself.
drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles
for delete to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) is not null
    and (select public.auth_company_id()) = public.profiles.company_id
    and (select auth.uid()) <> public.profiles.id
    and public.profiles.role in ('company_admin','team_member')
  )
);

-- Roles: an aims_guide assigned to the company (and, through
-- is_guide_for(), an assigned portfolio_admin, as before) may delete a
-- company_admin or team_member there, never itself.
drop policy if exists profiles_delete_guide on public.profiles;
create policy profiles_delete_guide on public.profiles
for delete to authenticated
using (
  public.profiles.company_id is not null
  and public.is_guide_for(public.profiles.company_id)
  and public.profiles.id <> auth.uid()
  and public.profiles.role in ('company_admin','team_member')
);

-- Roles: company_admin may update a company_admin or team_member in
-- its own company, never itself, and may not grant any other role.
drop policy if exists profiles_update_company_admin on public.profiles;
create policy profiles_update_company_admin on public.profiles
for update to authenticated
using (
  (select public.auth_role()) = 'company_admin'
  and (select public.auth_company_id()) is not null
  and (select public.auth_company_id()) = public.profiles.company_id
  and (select auth.uid()) <> public.profiles.id
  and public.profiles.role in ('company_admin','team_member')
)
with check (
  (select public.auth_role()) = 'company_admin'
  and (select public.auth_company_id()) is not null
  and (select public.auth_company_id()) = public.profiles.company_id
  and (select auth.uid()) <> public.profiles.id
  and public.profiles.role = any (array['company_admin', 'team_member'])
);

-- Roles: an aims_guide assigned to the company (and, through
-- is_guide_for(), an assigned portfolio_admin, as before) may update a
-- company_admin or team_member there, never itself, and may not grant
-- any other role.
drop policy if exists profiles_update_guide on public.profiles;
create policy profiles_update_guide on public.profiles
for update to authenticated
using (
  public.profiles.company_id is not null
  and public.is_guide_for(public.profiles.company_id)
  and public.profiles.id <> auth.uid()
  and public.profiles.role in ('company_admin','team_member')
)
with check (
  public.profiles.company_id is not null
  and public.is_guide_for(public.profiles.company_id)
  and public.profiles.role in ('company_admin','team_member')
  and public.profiles.id <> auth.uid()
);
