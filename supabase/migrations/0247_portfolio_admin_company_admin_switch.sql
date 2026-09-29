-- =============================================================
-- Migration 0247 — a portfolio admin a system admin makes a company's
-- admin acts as that company's admin
--
-- Jason, 2026-09-29: "Portfolio admins should be able to be added as a
-- company admin also. When that happens, and they are in that company,
-- they act as the company admin." Only system admins turn it on or off,
-- and who did it and when is recorded.
--
-- ---- WHAT A PORTFOLIO ADMIN HOLDS, AFTER THIS -----------------------
--
--   switched OFF (the default)   reads the company's content, writes its
--                                four tables (CLAUDE.md), keeps its own
--                                work (0246)
--   switched ON for a company    what that company's admin holds, in that
--                                company: the 75 content write rules and
--                                roll_quarter / record_external_pull
--
-- ---- HOW --------------------------------------------------------------
--
-- 1. portfolio_assignments.acts_as_company_admin, and who set it and
--    when (company_admin_set_by, company_admin_set_at). A trigger stamps
--    both whenever the switch changes, and refuses the change from a
--    signed-in caller who is not a system admin. With no signed-in
--    caller (a migration, the service role) it is allowed and stamped
--    with no person.
-- 2. portfolio_assignments_update_system_admin: the only update rule on
--    the table. A portfolio admin can still add and remove its own
--    assignments (0199, 0205), always with the switch off, and cannot
--    turn it on for itself.
-- 3. is_content_admin_for(company): an assigned aims_guide, or a
--    portfolio admin whose assignment to that company is switched on.
--    Every rule 0245 moved to is_assigned_guide_for moves to this, and so
--    do both functions. Every other clause is kept word for word. Reads
--    are not touched (0245's FOR SELECT twins stay).
-- 4. Promise One: Scot Lowry, Sean Wenger and Steve Kessen switched on,
--    by id, as 0207 did. A no-op where Promise One does not exist. Where
--    it does, anything but exactly three switched on aborts the whole
--    file, so the grant and its data land together or not at all.
--
-- Re-runnable: the same end state whether it lands after 0245 and 0246
-- (the dev clone) or anywhere else.
-- =============================================================

-- ---- 1. the switch, and who set it --------------------------------

alter table public.portfolio_assignments
  add column if not exists acts_as_company_admin boolean not null default false,
  add column if not exists company_admin_set_by uuid references public.profiles(id) on delete set null,
  add column if not exists company_admin_set_at timestamptz;

comment on column public.portfolio_assignments.acts_as_company_admin is
  'On: this portfolio admin acts as the company''s admin in this company (0247). '
  'Only a system admin changes it; company_admin_set_by and _at say who and when.';

create or replace function public.portfolio_assignment_admin_switch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.acts_as_company_admin is not distinct from old.acts_as_company_admin then
    new.company_admin_set_by := old.company_admin_set_by;
    new.company_admin_set_at := old.company_admin_set_at;
    return new;
  end if;
  if tg_op = 'INSERT' and not new.acts_as_company_admin then
    new.company_admin_set_by := null;
    new.company_admin_set_at := null;
    return new;
  end if;
  -- The switch is being set. Admits: a system admin, or no signed-in
  -- caller at all (a migration, the service role).
  if auth.uid() is not null and public.auth_role() is distinct from 'system_admin' then
    raise exception 'Only a system admin can make a portfolio admin a company''s admin.'
      using errcode = '42501';
  end if;
  new.company_admin_set_by := auth.uid();
  new.company_admin_set_at := now();
  return new;
end;
$$;

drop trigger if exists portfolio_assignment_admin_switch on public.portfolio_assignments;
create trigger portfolio_assignment_admin_switch
  before insert or update on public.portfolio_assignments
  for each row execute function public.portfolio_assignment_admin_switch();

-- ---- 2. only a system admin updates an assignment -----------------

-- Admits: system_admin.
drop policy if exists portfolio_assignments_update_system_admin on public.portfolio_assignments;
create policy portfolio_assignments_update_system_admin on public.portfolio_assignments
  for update to authenticated
  using ((select public.auth_role()) = 'system_admin')
  with check ((select public.auth_role()) = 'system_admin');

-- ---- 3. the helper --------------------------------------------------

create or replace function public.is_content_admin_for(target_company_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.is_assigned_guide_for(target_company_id)
    or exists (
      select 1
        from public.profiles p
        join public.portfolio_assignments pa on pa.portfolio_admin_id = p.id
       where p.id = auth.uid()
         and p.role = 'portfolio_admin'
         and pa.company_id = target_company_id
         and pa.acts_as_company_admin
    )
$$;

revoke all on function public.is_content_admin_for(uuid) from public;
grant execute on function public.is_content_admin_for(uuid) to authenticated;

comment on function public.is_content_admin_for(uuid) is
  'True for an aims_guide assigned to this company, or a portfolio_admin whose '
  'assignment to it a system admin has switched on as company admin (0247). '
  'The helper for content write rules. Never is_guide_for or is_admin_for in a '
  'write rule (CLAUDE.md).';

-- ---- 4. the rules and functions -------------------------------------

-- ---- annual_goals ----
-- annual_goals_delete_guide (DELETE) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "annual_goals_delete_guide" on public."annual_goals"
  using (public.is_content_admin_for(company_id));
comment on policy "annual_goals_delete_guide" on public."annual_goals" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';
-- annual_goals_insert_guide (INSERT) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "annual_goals_insert_guide" on public."annual_goals"
  with check (public.is_content_admin_for(company_id));
comment on policy "annual_goals_insert_guide" on public."annual_goals" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';
-- annual_goals_update_guide (UPDATE) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "annual_goals_update_guide" on public."annual_goals"
  using (public.is_content_admin_for(company_id))
  with check (public.is_content_admin_for(company_id));
comment on policy "annual_goals_update_guide" on public."annual_goals" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';

-- ---- commitment_occurrences ----
-- commitment_occurrences_write_admin (ALL) admits: system_admin, company_admin, an assigned aims_guide or a switched-on portfolio admin.
alter policy "commitment_occurrences_write_admin" on public."commitment_occurrences"
  using ((EXISTS ( SELECT 1
   FROM commitments c
  WHERE ((c.id = commitment_occurrences.commitment_id) AND ((( SELECT auth_role() AS auth_role) = 'system_admin'::text) OR ((( SELECT auth_role() AS auth_role) = 'company_admin'::text) AND (( SELECT auth_company_id() AS auth_company_id) = c.company_id)) OR public.is_content_admin_for(c.company_id))))))
  with check ((EXISTS ( SELECT 1
   FROM commitments c
  WHERE ((c.id = commitment_occurrences.commitment_id) AND ((( SELECT auth_role() AS auth_role) = 'system_admin'::text) OR ((( SELECT auth_role() AS auth_role) = 'company_admin'::text) AND (( SELECT auth_company_id() AS auth_company_id) = c.company_id)) OR public.is_content_admin_for(c.company_id))))));
comment on policy "commitment_occurrences_write_admin" on public."commitment_occurrences" is
  'Admits: system_admin, company_admin, an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';

-- ---- commitments ----
-- commitments_delete_guide (DELETE) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "commitments_delete_guide" on public."commitments"
  using (public.is_content_admin_for(company_id));
comment on policy "commitments_delete_guide" on public."commitments" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';
-- commitments_insert_guide (INSERT) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "commitments_insert_guide" on public."commitments"
  with check (public.is_content_admin_for(company_id));
comment on policy "commitments_insert_guide" on public."commitments" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';
-- commitments_update_guide (UPDATE) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "commitments_update_guide" on public."commitments"
  using (public.is_content_admin_for(company_id))
  with check (public.is_content_admin_for(company_id));
comment on policy "commitments_update_guide" on public."commitments" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';

-- ---- company_foundation ----
-- company_foundation_delete_guide (DELETE) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "company_foundation_delete_guide" on public."company_foundation"
  using (public.is_content_admin_for(company_id));
comment on policy "company_foundation_delete_guide" on public."company_foundation" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';
-- company_foundation_insert_guide (INSERT) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "company_foundation_insert_guide" on public."company_foundation"
  with check (public.is_content_admin_for(company_id));
comment on policy "company_foundation_insert_guide" on public."company_foundation" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';
-- company_foundation_update_guide (UPDATE) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "company_foundation_update_guide" on public."company_foundation"
  using (public.is_content_admin_for(company_id))
  with check (public.is_content_admin_for(company_id));
comment on policy "company_foundation_update_guide" on public."company_foundation" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';

-- ---- dashboard_ai_briefs ----
-- dashboard_ai_briefs_insert_guide (INSERT) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "dashboard_ai_briefs_insert_guide" on public."dashboard_ai_briefs"
  with check (public.is_content_admin_for(company_id));
comment on policy "dashboard_ai_briefs_insert_guide" on public."dashboard_ai_briefs" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';

-- ---- external_pull_log ----
-- external_pull_log_insert (INSERT) admits: system_admin, company_admin, an assigned aims_guide or a switched-on portfolio admin.
alter policy "external_pull_log_insert" on public."external_pull_log"
  with check (((( SELECT auth_role() AS auth_role) = 'system_admin'::text) OR ((( SELECT auth_role() AS auth_role) = 'company_admin'::text) AND (( SELECT auth_company_id() AS auth_company_id) IS NOT NULL) AND (( SELECT auth_company_id() AS auth_company_id) = company_id)) OR public.is_content_admin_for(company_id)));
comment on policy "external_pull_log_insert" on public."external_pull_log" is
  'Admits: system_admin, company_admin, an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';

-- ---- foundation_items ----
-- foundation_items_delete_guide (DELETE) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "foundation_items_delete_guide" on public."foundation_items"
  using (public.is_content_admin_for(company_id));
comment on policy "foundation_items_delete_guide" on public."foundation_items" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';
-- foundation_items_insert_guide (INSERT) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "foundation_items_insert_guide" on public."foundation_items"
  with check (public.is_content_admin_for(company_id));
comment on policy "foundation_items_insert_guide" on public."foundation_items" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';
-- foundation_items_update_guide (UPDATE) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "foundation_items_update_guide" on public."foundation_items"
  using (public.is_content_admin_for(company_id))
  with check (public.is_content_admin_for(company_id));
comment on policy "foundation_items_update_guide" on public."foundation_items" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';

-- ---- function_competencies ----
-- function_competencies_delete_guide (DELETE) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "function_competencies_delete_guide" on public."function_competencies"
  using (public.is_content_admin_for(( SELECT functions.company_id
   FROM functions
  WHERE (functions.id = function_competencies.function_id))));
comment on policy "function_competencies_delete_guide" on public."function_competencies" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';
-- function_competencies_insert_guide (INSERT) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "function_competencies_insert_guide" on public."function_competencies"
  with check (public.is_content_admin_for(( SELECT functions.company_id
   FROM functions
  WHERE (functions.id = function_competencies.function_id))));
comment on policy "function_competencies_insert_guide" on public."function_competencies" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';
-- function_competencies_update_guide (UPDATE) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "function_competencies_update_guide" on public."function_competencies"
  using (public.is_content_admin_for(( SELECT functions.company_id
   FROM functions
  WHERE (functions.id = function_competencies.function_id))))
  with check (public.is_content_admin_for(( SELECT functions.company_id
   FROM functions
  WHERE (functions.id = function_competencies.function_id))));
comment on policy "function_competencies_update_guide" on public."function_competencies" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';

-- ---- function_decision_rights ----
-- function_decision_rights_delete_guide (DELETE) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "function_decision_rights_delete_guide" on public."function_decision_rights"
  using (public.is_content_admin_for(( SELECT functions.company_id
   FROM functions
  WHERE (functions.id = function_decision_rights.function_id))));
comment on policy "function_decision_rights_delete_guide" on public."function_decision_rights" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';
-- function_decision_rights_insert_guide (INSERT) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "function_decision_rights_insert_guide" on public."function_decision_rights"
  with check (public.is_content_admin_for(( SELECT functions.company_id
   FROM functions
  WHERE (functions.id = function_decision_rights.function_id))));
comment on policy "function_decision_rights_insert_guide" on public."function_decision_rights" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';
-- function_decision_rights_update_guide (UPDATE) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "function_decision_rights_update_guide" on public."function_decision_rights"
  using (public.is_content_admin_for(( SELECT functions.company_id
   FROM functions
  WHERE (functions.id = function_decision_rights.function_id))))
  with check (public.is_content_admin_for(( SELECT functions.company_id
   FROM functions
  WHERE (functions.id = function_decision_rights.function_id))));
comment on policy "function_decision_rights_update_guide" on public."function_decision_rights" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';

-- ---- function_roles ----
-- function_roles_delete_guide (DELETE) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "function_roles_delete_guide" on public."function_roles"
  using (((is_default = false) AND (EXISTS ( SELECT 1
   FROM functions f
  WHERE ((f.id = function_roles.function_id) AND public.is_content_admin_for(f.company_id))))));
comment on policy "function_roles_delete_guide" on public."function_roles" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';
-- function_roles_insert_guide (INSERT) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "function_roles_insert_guide" on public."function_roles"
  with check ((EXISTS ( SELECT 1
   FROM functions f
  WHERE ((f.id = function_roles.function_id) AND public.is_content_admin_for(f.company_id)))));
comment on policy "function_roles_insert_guide" on public."function_roles" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';
-- function_roles_update_guide (UPDATE) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "function_roles_update_guide" on public."function_roles"
  using (((is_default = false) AND (EXISTS ( SELECT 1
   FROM functions f
  WHERE ((f.id = function_roles.function_id) AND public.is_content_admin_for(f.company_id))))))
  with check (((is_default = false) AND (EXISTS ( SELECT 1
   FROM functions f
  WHERE ((f.id = function_roles.function_id) AND public.is_content_admin_for(f.company_id))))));
comment on policy "function_roles_update_guide" on public."function_roles" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';

-- ---- functional_areas ----
-- functional_areas_delete_guide (DELETE) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "functional_areas_delete_guide" on public."functional_areas"
  using (public.is_content_admin_for(company_id));
comment on policy "functional_areas_delete_guide" on public."functional_areas" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';
-- functional_areas_insert_guide (INSERT) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "functional_areas_insert_guide" on public."functional_areas"
  with check (public.is_content_admin_for(company_id));
comment on policy "functional_areas_insert_guide" on public."functional_areas" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';
-- functional_areas_update_guide (UPDATE) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "functional_areas_update_guide" on public."functional_areas"
  using (public.is_content_admin_for(company_id))
  with check (public.is_content_admin_for(company_id));
comment on policy "functional_areas_update_guide" on public."functional_areas" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';

-- ---- functions ----
-- functions_delete_guide (DELETE) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "functions_delete_guide" on public."functions"
  using (public.is_content_admin_for(company_id));
comment on policy "functions_delete_guide" on public."functions" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';
-- functions_insert_guide (INSERT) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "functions_insert_guide" on public."functions"
  with check (public.is_content_admin_for(company_id));
comment on policy "functions_insert_guide" on public."functions" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';
-- functions_update_guide (UPDATE) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "functions_update_guide" on public."functions"
  using (public.is_content_admin_for(company_id))
  with check (public.is_content_admin_for(company_id));
comment on policy "functions_update_guide" on public."functions" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';

-- ---- issues ----
-- issues_insert_admin (INSERT) admits: system_admin, company_admin, an assigned aims_guide or a switched-on portfolio admin.
alter policy "issues_insert_admin" on public."issues"
  with check (((( SELECT auth_role() AS auth_role) = 'system_admin'::text) OR ((( SELECT auth_role() AS auth_role) = 'company_admin'::text) AND (( SELECT auth_company_id() AS auth_company_id) = company_id)) OR public.is_content_admin_for(company_id)));
comment on policy "issues_insert_admin" on public."issues" is
  'Admits: system_admin, company_admin, an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';
-- issues_update_guide (UPDATE) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "issues_update_guide" on public."issues"
  using (public.is_content_admin_for(company_id))
  with check (public.is_content_admin_for(company_id));
comment on policy "issues_update_guide" on public."issues" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';

-- ---- marketing_snippets ----
-- marketing_snippets_delete_guide (DELETE) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "marketing_snippets_delete_guide" on public."marketing_snippets"
  using (public.is_content_admin_for(company_id));
comment on policy "marketing_snippets_delete_guide" on public."marketing_snippets" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';
-- marketing_snippets_insert_guide (INSERT) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "marketing_snippets_insert_guide" on public."marketing_snippets"
  with check (public.is_content_admin_for(company_id));
comment on policy "marketing_snippets_insert_guide" on public."marketing_snippets" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';
-- marketing_snippets_update_guide (UPDATE) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "marketing_snippets_update_guide" on public."marketing_snippets"
  using (public.is_content_admin_for(company_id))
  with check (public.is_content_admin_for(company_id));
comment on policy "marketing_snippets_update_guide" on public."marketing_snippets" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';

-- ---- marketing_strategy ----
-- marketing_strategy_delete_guide (DELETE) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "marketing_strategy_delete_guide" on public."marketing_strategy"
  using (public.is_content_admin_for(company_id));
comment on policy "marketing_strategy_delete_guide" on public."marketing_strategy" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';
-- marketing_strategy_insert_guide (INSERT) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "marketing_strategy_insert_guide" on public."marketing_strategy"
  with check (public.is_content_admin_for(company_id));
comment on policy "marketing_strategy_insert_guide" on public."marketing_strategy" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';
-- marketing_strategy_update_guide (UPDATE) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "marketing_strategy_update_guide" on public."marketing_strategy"
  using (public.is_content_admin_for(company_id))
  with check (public.is_content_admin_for(company_id));
comment on policy "marketing_strategy_update_guide" on public."marketing_strategy" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';

-- ---- meetings ----
-- meetings_update_guide (UPDATE) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "meetings_update_guide" on public."meetings"
  using (((company_id IS NOT NULL) AND public.is_content_admin_for(company_id)))
  with check (((company_id IS NOT NULL) AND public.is_content_admin_for(company_id)));
comment on policy "meetings_update_guide" on public."meetings" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';

-- ---- messaging_pillars ----
-- messaging_pillars_delete_guide (DELETE) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "messaging_pillars_delete_guide" on public."messaging_pillars"
  using (public.is_content_admin_for(company_id));
comment on policy "messaging_pillars_delete_guide" on public."messaging_pillars" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';
-- messaging_pillars_insert_guide (INSERT) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "messaging_pillars_insert_guide" on public."messaging_pillars"
  with check (public.is_content_admin_for(company_id));
comment on policy "messaging_pillars_insert_guide" on public."messaging_pillars" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';
-- messaging_pillars_update_guide (UPDATE) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "messaging_pillars_update_guide" on public."messaging_pillars"
  using (public.is_content_admin_for(company_id))
  with check (public.is_content_admin_for(company_id));
comment on policy "messaging_pillars_update_guide" on public."messaging_pillars" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';

-- ---- priorities ----
-- priorities_delete_guide (DELETE) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "priorities_delete_guide" on public."priorities"
  using (public.is_content_admin_for(company_id));
comment on policy "priorities_delete_guide" on public."priorities" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';
-- priorities_insert_guide (INSERT) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "priorities_insert_guide" on public."priorities"
  with check (public.is_content_admin_for(company_id));
comment on policy "priorities_insert_guide" on public."priorities" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';
-- priorities_update_guide (UPDATE) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "priorities_update_guide" on public."priorities"
  using (public.is_content_admin_for(company_id))
  with check (public.is_content_admin_for(company_id));
comment on policy "priorities_update_guide" on public."priorities" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';

-- ---- quarters ----
-- quarters_delete_guide (DELETE) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "quarters_delete_guide" on public."quarters"
  using (public.is_content_admin_for(company_id));
comment on policy "quarters_delete_guide" on public."quarters" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';
-- quarters_insert_guide (INSERT) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "quarters_insert_guide" on public."quarters"
  with check (public.is_content_admin_for(company_id));
comment on policy "quarters_insert_guide" on public."quarters" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';
-- quarters_update_guide (UPDATE) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "quarters_update_guide" on public."quarters"
  using (public.is_content_admin_for(company_id))
  with check (public.is_content_admin_for(company_id));
comment on policy "quarters_update_guide" on public."quarters" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';

-- ---- role_description_documents ----
-- role_description_documents_delete_guide (DELETE) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "role_description_documents_delete_guide" on public."role_description_documents"
  using (public.is_content_admin_for(( SELECT functions.company_id
   FROM functions
  WHERE (functions.id = role_description_documents.function_id))));
comment on policy "role_description_documents_delete_guide" on public."role_description_documents" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';
-- role_description_documents_insert_guide (INSERT) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "role_description_documents_insert_guide" on public."role_description_documents"
  with check (public.is_content_admin_for(( SELECT functions.company_id
   FROM functions
  WHERE (functions.id = role_description_documents.function_id))));
comment on policy "role_description_documents_insert_guide" on public."role_description_documents" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';
-- role_description_documents_update_guide (UPDATE) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "role_description_documents_update_guide" on public."role_description_documents"
  using (public.is_content_admin_for(( SELECT functions.company_id
   FROM functions
  WHERE (functions.id = role_description_documents.function_id))))
  with check (public.is_content_admin_for(( SELECT functions.company_id
   FROM functions
  WHERE (functions.id = role_description_documents.function_id))));
comment on policy "role_description_documents_update_guide" on public."role_description_documents" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';

-- ---- scorecard_entries ----
-- scorecard_entries_delete_guide (DELETE) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "scorecard_entries_delete_guide" on public."scorecard_entries"
  using ((EXISTS ( SELECT 1
   FROM scorecard_metrics m
  WHERE ((m.id = scorecard_entries.metric_id) AND public.is_content_admin_for(m.company_id)))));
comment on policy "scorecard_entries_delete_guide" on public."scorecard_entries" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';
-- scorecard_entries_insert_guide (INSERT) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "scorecard_entries_insert_guide" on public."scorecard_entries"
  with check ((EXISTS ( SELECT 1
   FROM scorecard_metrics m
  WHERE ((m.id = scorecard_entries.metric_id) AND public.is_content_admin_for(m.company_id)))));
comment on policy "scorecard_entries_insert_guide" on public."scorecard_entries" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';
-- scorecard_entries_update_guide (UPDATE) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "scorecard_entries_update_guide" on public."scorecard_entries"
  using ((EXISTS ( SELECT 1
   FROM scorecard_metrics m
  WHERE ((m.id = scorecard_entries.metric_id) AND public.is_content_admin_for(m.company_id)))))
  with check ((EXISTS ( SELECT 1
   FROM scorecard_metrics m
  WHERE ((m.id = scorecard_entries.metric_id) AND public.is_content_admin_for(m.company_id)))));
comment on policy "scorecard_entries_update_guide" on public."scorecard_entries" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';

-- ---- scorecard_metrics ----
-- scorecard_metrics_delete_guide (DELETE) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "scorecard_metrics_delete_guide" on public."scorecard_metrics"
  using (public.is_content_admin_for(company_id));
comment on policy "scorecard_metrics_delete_guide" on public."scorecard_metrics" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';
-- scorecard_metrics_insert_guide (INSERT) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "scorecard_metrics_insert_guide" on public."scorecard_metrics"
  with check (public.is_content_admin_for(company_id));
comment on policy "scorecard_metrics_insert_guide" on public."scorecard_metrics" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';
-- scorecard_metrics_update_guide (UPDATE) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "scorecard_metrics_update_guide" on public."scorecard_metrics"
  using (public.is_content_admin_for(company_id))
  with check (public.is_content_admin_for(company_id));
comment on policy "scorecard_metrics_update_guide" on public."scorecard_metrics" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';

-- ---- session_briefs ----
-- session_briefs_insert (INSERT) admits: system_admin, an assigned aims_guide or a switched-on portfolio admin, the person the row belongs to.
alter policy "session_briefs_insert" on public."session_briefs"
  with check (((generated_by = ( SELECT auth.uid() AS uid)) AND ((( SELECT auth_role() AS auth_role) = 'system_admin'::text) OR public.is_content_admin_for(company_id))));
comment on policy "session_briefs_insert" on public."session_briefs" is
  'Admits: system_admin, an assigned aims_guide or a portfolio admin switched on as this company''s admin, the person the row belongs to (0247).';

-- ---- strategic_focus_areas ----
-- strategic_focus_areas_delete_guide (DELETE) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "strategic_focus_areas_delete_guide" on public."strategic_focus_areas"
  using (public.is_content_admin_for(company_id));
comment on policy "strategic_focus_areas_delete_guide" on public."strategic_focus_areas" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';
-- strategic_focus_areas_insert_guide (INSERT) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "strategic_focus_areas_insert_guide" on public."strategic_focus_areas"
  with check (public.is_content_admin_for(company_id));
comment on policy "strategic_focus_areas_insert_guide" on public."strategic_focus_areas" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';
-- strategic_focus_areas_update_guide (UPDATE) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "strategic_focus_areas_update_guide" on public."strategic_focus_areas"
  using (public.is_content_admin_for(company_id))
  with check (public.is_content_admin_for(company_id));
comment on policy "strategic_focus_areas_update_guide" on public."strategic_focus_areas" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';

-- ---- strengths_team_members ----
-- strengths_team_members_delete_guide (DELETE) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "strengths_team_members_delete_guide" on public."strengths_team_members"
  using ((EXISTS ( SELECT 1
   FROM strengths_teams t
  WHERE ((t.id = strengths_team_members.team_id) AND public.is_content_admin_for(t.company_id)))));
comment on policy "strengths_team_members_delete_guide" on public."strengths_team_members" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';
-- strengths_team_members_insert_guide (INSERT) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "strengths_team_members_insert_guide" on public."strengths_team_members"
  with check ((EXISTS ( SELECT 1
   FROM strengths_teams t
  WHERE ((t.id = strengths_team_members.team_id) AND public.is_content_admin_for(t.company_id)))));
comment on policy "strengths_team_members_insert_guide" on public."strengths_team_members" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';
-- strengths_team_members_update_guide (UPDATE) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "strengths_team_members_update_guide" on public."strengths_team_members"
  using ((EXISTS ( SELECT 1
   FROM strengths_teams t
  WHERE ((t.id = strengths_team_members.team_id) AND public.is_content_admin_for(t.company_id)))))
  with check ((EXISTS ( SELECT 1
   FROM strengths_teams t
  WHERE ((t.id = strengths_team_members.team_id) AND public.is_content_admin_for(t.company_id)))));
comment on policy "strengths_team_members_update_guide" on public."strengths_team_members" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';

-- ---- strengths_teams ----
-- strengths_teams_delete_guide (DELETE) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "strengths_teams_delete_guide" on public."strengths_teams"
  using (public.is_content_admin_for(company_id));
comment on policy "strengths_teams_delete_guide" on public."strengths_teams" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';
-- strengths_teams_insert_guide (INSERT) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "strengths_teams_insert_guide" on public."strengths_teams"
  with check ((company_has_feature(company_id, 'strengths'::text) AND public.is_content_admin_for(company_id)));
comment on policy "strengths_teams_insert_guide" on public."strengths_teams" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';
-- strengths_teams_update_guide (UPDATE) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "strengths_teams_update_guide" on public."strengths_teams"
  using (public.is_content_admin_for(company_id))
  with check (public.is_content_admin_for(company_id));
comment on policy "strengths_teams_update_guide" on public."strengths_teams" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';

-- ---- success_measure_entries ----
-- success_measure_entries_write_guide (ALL) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "success_measure_entries_write_guide" on public."success_measure_entries"
  using ((EXISTS ( SELECT 1
   FROM (success_measures sm
     JOIN functions f ON ((f.id = sm.function_id)))
  WHERE ((sm.id = success_measure_entries.measure_id) AND public.is_content_admin_for(f.company_id)))))
  with check ((EXISTS ( SELECT 1
   FROM (success_measures sm
     JOIN functions f ON ((f.id = sm.function_id)))
  WHERE ((sm.id = success_measure_entries.measure_id) AND public.is_content_admin_for(f.company_id)))));
comment on policy "success_measure_entries_write_guide" on public."success_measure_entries" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';

-- ---- success_measures ----
-- success_measures_write_by_function_guide (ALL) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "success_measures_write_by_function_guide" on public."success_measures"
  using ((EXISTS ( SELECT 1
   FROM functions f
  WHERE ((f.id = success_measures.function_id) AND public.is_content_admin_for(f.company_id)))))
  with check ((EXISTS ( SELECT 1
   FROM functions f
  WHERE ((f.id = success_measures.function_id) AND public.is_content_admin_for(f.company_id)))));
comment on policy "success_measures_write_by_function_guide" on public."success_measures" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';

-- ---- transcript_aliases ----
-- transcript_aliases_delete_guide (DELETE) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "transcript_aliases_delete_guide" on public."transcript_aliases"
  using (public.is_content_admin_for(company_id));
comment on policy "transcript_aliases_delete_guide" on public."transcript_aliases" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';
-- transcript_aliases_insert_guide (INSERT) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "transcript_aliases_insert_guide" on public."transcript_aliases"
  with check (public.is_content_admin_for(company_id));
comment on policy "transcript_aliases_insert_guide" on public."transcript_aliases" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';
-- transcript_aliases_update_guide (UPDATE) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "transcript_aliases_update_guide" on public."transcript_aliases"
  using (public.is_content_admin_for(company_id))
  with check (public.is_content_admin_for(company_id));
comment on policy "transcript_aliases_update_guide" on public."transcript_aliases" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';

-- ---- transcript_sources ----
-- transcript_sources_delete_guide (DELETE) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "transcript_sources_delete_guide" on public."transcript_sources"
  using (((company_id IS NOT NULL) AND public.is_content_admin_for(company_id)));
comment on policy "transcript_sources_delete_guide" on public."transcript_sources" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';
-- transcript_sources_insert_guide (INSERT) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "transcript_sources_insert_guide" on public."transcript_sources"
  with check (((company_id IS NOT NULL) AND public.is_content_admin_for(company_id)));
comment on policy "transcript_sources_insert_guide" on public."transcript_sources" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';
-- transcript_sources_update_guide (UPDATE) admits: an assigned aims_guide or a switched-on portfolio admin.
alter policy "transcript_sources_update_guide" on public."transcript_sources"
  using (((company_id IS NOT NULL) AND public.is_content_admin_for(company_id)))
  with check (((company_id IS NOT NULL) AND public.is_content_admin_for(company_id)));
comment on policy "transcript_sources_update_guide" on public."transcript_sources" is
  'Admits: an assigned aims_guide or a portfolio admin switched on as this company''s admin (0247).';

-- ---- the two functions ----
-- roll_quarter: admits system_admin, the company's own company_admin, an assigned aims_guide, a switched-on portfolio admin.
CREATE OR REPLACE FUNCTION public.roll_quarter(p_company_id uuid, p_label text, p_start_date date, p_end_date date)
 RETURNS TABLE(closed_quarter uuid, opened_quarter uuid, moved integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_old uuid;
  v_new uuid;
  v_moved integer := 0;
begin
  if v_uid is null then
    raise exception 'roll_quarter requires an authenticated caller';
  end if;

  -- The same set the quarter actions admit: system_admin, the
  -- company's own admin, an assigned guide, or a portfolio admin a
  -- system admin has switched on as this company's admin (0247).
  if not (
    public.auth_role() = 'system_admin'
    or (
      public.auth_role() = 'company_admin'
      and public.auth_company_id() = p_company_id
    )
    or public.is_content_admin_for(p_company_id)
  ) then
    raise exception 'roll_quarter: not permitted for this company'
      using errcode = '42501';
  end if;

  if p_label is null or btrim(p_label) = '' then
    raise exception 'roll_quarter: the new quarter needs a label';
  end if;
  if p_start_date is null or p_end_date is null then
    raise exception 'roll_quarter: the new quarter needs both dates';
  end if;
  if p_end_date < p_start_date then
    raise exception 'roll_quarter: the end date cannot come before the start date';
  end if;

  -- There may be none, and that is a normal state rather than an
  -- error: a company whose quarter was never opened, or one rolling
  -- after somebody closed by hand. Then this is simply an open.
  select id into v_old
    from public.quarters
   where company_id = p_company_id and status = 'open';

  if v_old is not null then
    update public.quarters set status = 'closed' where id = v_old;
  end if;

  insert into public.quarters (company_id, label, start_date, end_date, status)
  values (p_company_id, btrim(p_label), p_start_date, p_end_date, 'open')
  returning id into v_new;

  -- The carry-forward. Complete priorities stay where they were
  -- finished, which is what makes the closed quarter an honest record
  -- of what the team actually landed.
  if v_old is not null then
    update public.priorities
       set quarter_id = v_new
     where quarter_id = v_old
       and status <> 'complete';
    get diagnostics v_moved = row_count;
  end if;

  return query select v_old, v_new, v_moved;
end;
$function$;
-- record_external_pull: admits system_admin, the company's own company_admin, an assigned aims_guide, a switched-on portfolio admin.
CREATE OR REPLACE FUNCTION public.record_external_pull(p_measure_id uuid, p_week_ending date, p_mapping_kind text, p_outcome text, p_value numeric DEFAULT NULL::numeric, p_failure_reason text DEFAULT NULL::text, p_detail jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(outcome text, log_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_company uuid;
begin
  if v_uid is null then
    raise exception 'record_external_pull requires an authenticated caller';
  end if;

  select f.company_id into v_company
  from public.success_measures m
  join public.functions f on f.id = m.function_id
  where m.id = p_measure_id;

  if v_company is null then
    raise exception 'record_external_pull: no such measure, or it belongs to no function';
  end if;

  if not (
    public.auth_role() = 'system_admin'
    or (
      public.auth_role() = 'company_admin'
      and public.auth_company_id() = v_company
    )
    or public.is_content_admin_for(v_company)
  ) then
    raise exception 'record_external_pull: not permitted for this company'
      using errcode = '42501';
  end if;

  -- A person pressing Pull now is asking for a fresh read, so a
  -- value this feature wrote earlier may be replaced. A value a
  -- person typed may not, and that is decided inside.
  return query select * from public._record_external_pull(
    p_measure_id, p_week_ending, p_mapping_kind, p_outcome,
    p_value, p_failure_reason, p_detail, v_uid, true
  );
end;
$function$;

-- ---- 5. Promise One ----------------------------------------------------
--
-- Scot Lowry was Promise One's company admin before becoming a portfolio
-- admin; 0207 promoted Sean Wenger and Steve Kessen "and keep running
-- Promise One". Switched on here so they keep doing so (Jason,
-- 2026-09-29). Stamped with no person: set by this migration.

do $$
declare
  promise_one constant uuid := '54bac6cf-aabb-4e7a-a083-eda16a8e5460';
  people constant uuid[] := array[
    '689da76d-345d-47d0-a1f6-07d654814e5a',  -- Scot Lowry
    '52e077c5-6ee4-4cca-b4a4-a39b5bd6bfc5',  -- Sean Wenger
    '96cba0fc-9f08-4732-9a07-09ad880763e0'   -- Steve Kessen
  ];
  switched int;
begin
  if not exists (select 1 from public.companies where id = promise_one) then
    raise notice '0247: Promise One is not on this database; no switches set.';
    return;
  end if;
  update public.portfolio_assignments
     set acts_as_company_admin = true
   where company_id = promise_one
     and portfolio_admin_id = any (people);
  select count(*) into switched
    from public.portfolio_assignments
   where company_id = promise_one
     and portfolio_admin_id = any (people)
     and acts_as_company_admin;
  if switched <> 3 then
    raise exception '0247: expected Scot Lowry, Sean Wenger and Steve Kessen switched on as Promise One''s admins, found %', switched;
  end if;
  raise notice '0247: Promise One: 3 portfolio admins switched on as company admin.';
end $$;
