-- =============================================================
-- Migration 0330 — a portfolio admin can have a company of their own
--
-- WHY. Jason, 2026-11-24. Steve Kessen, Scot Lowry and Sean Wenger run
-- Promise One and are the PromiseOne instance's portfolio admins. 0207
-- took Steve and Sean off Promise One's roster to make them portfolio
-- admins, because profiles_portfolio_admin_has_no_company (0190) said a
-- portfolio admin has no company. Since then Promise One has had no
-- members at all, so its owner pickers list nobody: Steve can give a
-- commitment only to himself, and a quarterly priority to nobody.
--
-- A coach can already belong to a company of their own (0300), and a
-- system admin too. This lets a system admin do the same for a
-- portfolio admin: profiles.company_id makes them a MEMBER (its chart,
-- owner pickers, Team list, meetings), and their role stays
-- portfolio_admin, so the Portfolio view stays theirs.
--
-- WHAT 0190 AND 0200 WARNED ABOUT, AND WHY IT HOLDS NOW. A company_id
-- makes every `auth_company_id() = company_id` rule true for that one
-- company, and some of those grant member writes (issues_insert_member,
-- commitments_claim_unassigned, commitments_insert_for_colleague).
-- 0200's objection was rights from a company with NO assignment behind
-- them. So the company must be one they are assigned to, and the
-- database says so, not only the app:
--
--   1. profiles_portfolio_admin_has_no_company goes.
--   2. A trigger on profiles refuses a portfolio admin's company_id
--      unless a portfolio_assignments row names them and that company.
--   3. A trigger on portfolio_assignments refuses deleting the
--      assignment to a portfolio admin's own company while it is
--      theirs. Clear their company first.
--
-- The app (lib/portfolio/own-company-actions.ts) also switches the
-- assignment on as company admin (0245), so in their own company they
-- do what its company_admin does, which is what 0245 already allows.
--
-- NOT CHANGED, and checked. Every update and delete rule on profiles
-- that admits a company's admin or a guide requires the target row's
-- role to be a member role (0300, 0321), so nobody but a system admin
-- edits, demotes or deletes the portfolio admin's account, and
-- profiles_update_self pins their own company_id. home_company_id
-- (0200) is untouched. Harness probe "a portfolio admin's own company".
-- =============================================================

alter table public.profiles
  drop constraint if exists profiles_portfolio_admin_has_no_company;

-- ---- 2. their company is one they are assigned to ----------------

create or replace function public.profiles_portfolio_admin_company_assigned()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role = 'portfolio_admin'
     and new.company_id is not null
     and not exists (
       select 1 from public.portfolio_assignments pa
       where pa.portfolio_admin_id = new.id
         and pa.company_id = new.company_id
     ) then
    raise exception 'A portfolio admin''s own company must be one they are assigned to.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.profiles_portfolio_admin_company_assigned() from public;

drop trigger if exists profiles_portfolio_admin_company_assigned on public.profiles;
create trigger profiles_portfolio_admin_company_assigned
  before insert or update of role, company_id on public.profiles
  for each row execute function public.profiles_portfolio_admin_company_assigned();

-- ---- 3. their own company's assignment stays while it is theirs ---

create or replace function public.portfolio_assignments_keep_own_company()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.profiles p
    where p.id = old.portfolio_admin_id
      and p.role = 'portfolio_admin'
      and p.company_id = old.company_id
  ) then
    raise exception 'This is their own company. Clear their own company before removing their access to it.'
      using errcode = '23514';
  end if;
  return old;
end;
$$;

revoke all on function public.portfolio_assignments_keep_own_company() from public;

drop trigger if exists portfolio_assignments_keep_own_company on public.portfolio_assignments;
create trigger portfolio_assignments_keep_own_company
  before delete on public.portfolio_assignments
  for each row execute function public.portfolio_assignments_keep_own_company();
