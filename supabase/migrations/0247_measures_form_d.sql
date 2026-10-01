-- 0247: reading Critical Success Factor measures and their weekly
-- entries no longer re-checks access through two joins per row.
--
-- WHY. Measured read-only on production (2026-09-30): a team member's
-- read of one company's 132 measure entries took 1.4 seconds, against
-- 1.6 ms with the rules skipped. The plan read `functions` 2,344 times
-- and called is_guide_for 2,348 times, about 18 times per row. Three
-- things did it, none of them the Form D helpers (those were already
-- hoisted):
--
--   1. Every rule on success_measure_entries reached the company
--      through success_measures and functions, an EXISTS per row, and
--      those two tables' own rules ran again inside it.
--   2. The two write rules on each table were FOR ALL, so every READ
--      paid for them too: Postgres ORs every permissive rule that
--      applies to the command, and ALL applies to SELECT.
--   3. The guide rules called is_guide_for(f.company_id) per row,
--      which cannot be hoisted because it depends on the row.
--
-- WHAT. Who may read and who may write stays exactly as it was:
--
--   a. company_id on both tables, set from the parent row by a
--      trigger on every insert and update, so it cannot be written
--      directly and cannot drift. Backfilled here. functions.company_id
--      changing would carry through (a trigger on functions), though
--      nothing in the app moves a function between companies.
--   b. The read rules check the row's own company_id, Form D
--      ((select public.auth_company_id()) = company_id), with no join.
--   c. The guide read rules check membership in one hoisted array,
--      public.admin_company_ids(), the same set is_admin_for() (which
--      is_guide_for() wraps) admits, evaluated once per query.
--   d. The FOR ALL write rules become separate INSERT, UPDATE and
--      DELETE rules with their expressions unchanged, so writes are
--      judged exactly as before and reads no longer pay for them.
--      Nobody read these rows through a write rule alone: every
--      caller a write rule admits is already admitted by a read rule
--      (system admin; a company admin or a function's lead or tracker,
--      all in the row's company; an assigned guide; a portfolio admin).
--
-- Not hoisted on purpose: the write rules keep their joins. They are
-- evaluated only on writes, one row at a time.

-- ---- a. company_id, kept from the parent ---------------------------------

alter table public.success_measures
  add column if not exists company_id uuid references public.companies(id) on delete cascade;
alter table public.success_measure_entries
  add column if not exists company_id uuid references public.companies(id) on delete cascade;

comment on column public.success_measures.company_id is
  'The function''s company, set by trigger from functions on every insert and update (0247). Never written directly. For the read rules, which then need no join.';
comment on column public.success_measure_entries.company_id is
  'The measure''s company, set by trigger from success_measures on every insert and update (0247). Never written directly. For the read rules, which then need no join.';

-- Definer, so the parent lookup sees the parent whatever the writer's own
-- read rules allow. It only copies a value the row is about to be checked
-- against; it grants nothing.
create or replace function public.success_measures_company_from_function()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.company_id := (select f.company_id from public.functions f where f.id = new.function_id);
  return new;
end;
$$;

create or replace function public.success_measure_entries_company_from_measure()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.company_id := (select m.company_id from public.success_measures m where m.id = new.measure_id);
  return new;
end;
$$;

-- A function that changes company carries its measures and their entries.
create or replace function public.functions_company_to_measures()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.company_id is distinct from old.company_id then
    update public.success_measures set company_id = new.company_id where function_id = new.id;
    update public.success_measure_entries e set company_id = new.company_id
      from public.success_measures m
     where m.id = e.measure_id and m.function_id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.success_measures_company_from_function() from public;
revoke all on function public.success_measure_entries_company_from_measure() from public;
revoke all on function public.functions_company_to_measures() from public;

drop trigger if exists success_measures_company on public.success_measures;
create trigger success_measures_company
  before insert or update on public.success_measures
  for each row execute function public.success_measures_company_from_function();

drop trigger if exists success_measure_entries_company on public.success_measure_entries;
create trigger success_measure_entries_company
  before insert or update on public.success_measure_entries
  for each row execute function public.success_measure_entries_company_from_measure();

drop trigger if exists functions_company_to_measures on public.functions;
create trigger functions_company_to_measures
  after update of company_id on public.functions
  for each row execute function public.functions_company_to_measures();

-- Backfill, parents first. Direct updates rather than through the trigger,
-- so updated_at and the target history are left alone: this is not an
-- edit anybody made.
alter table public.success_measures disable trigger user;
alter table public.success_measure_entries disable trigger user;
update public.success_measures m set company_id = f.company_id
  from public.functions f where f.id = m.function_id and m.company_id is distinct from f.company_id;
update public.success_measure_entries e set company_id = m.company_id
  from public.success_measures m where m.id = e.measure_id and e.company_id is distinct from m.company_id;
alter table public.success_measures enable trigger user;
alter table public.success_measure_entries enable trigger user;

alter table public.success_measures alter column company_id set not null;
alter table public.success_measure_entries alter column company_id set not null;

create index if not exists success_measures_company_id_idx on public.success_measures (company_id);
create index if not exists success_measure_entries_company_id_idx on public.success_measure_entries (company_id);

-- ---- c. the guide set, hoisted ---------------------------------------------

-- Every company is_admin_for() would admit this caller to: an assigned
-- aims_guide's companies and an assigned portfolio_admin's. READ RULES
-- ONLY. It admits assigned portfolio admins, so it must never appear in a
-- write rule (CLAUDE.md, Permissions; failure mode E19).
create or replace function public.admin_company_ids()
returns uuid[]
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(array_agg(distinct s.company_id), '{}')
    from (
      select ga.company_id
        from public.profiles p
        join public.guide_assignments ga on ga.guide_id = p.id
       where p.id = auth.uid() and p.role = 'aims_guide'
      union all
      select pa.company_id
        from public.profiles p
        join public.portfolio_assignments pa on pa.portfolio_admin_id = p.id
       where p.id = auth.uid() and p.role = 'portfolio_admin'
    ) s
$$;
revoke all on function public.admin_company_ids() from public;
grant execute on function public.admin_company_ids() to authenticated;
comment on function public.admin_company_ids() is
  'Companies is_admin_for() admits the caller to, as one array, for hoisted read rules (0247). Admits assigned portfolio admins: never use in a write rule.';

-- ---- b, c. the read rules ---------------------------------------------------

-- success_measure_entries_select (SELECT) admits: a system admin; anyone whose own company is the row's company.
drop policy if exists success_measure_entries_select on public.success_measure_entries;
create policy success_measure_entries_select on public.success_measure_entries
  for select to authenticated
  using (
    (select public.auth_role()) = 'system_admin'
    or ((select public.auth_company_id()) is not null and (select public.auth_company_id()) = company_id)
  );

-- success_measure_entries_select_guide (SELECT) admits: an assigned aims_guide or an assigned portfolio_admin.
drop policy if exists success_measure_entries_select_guide on public.success_measure_entries;
create policy success_measure_entries_select_guide on public.success_measure_entries
  for select to authenticated
  using (company_id = any ((select public.admin_company_ids())::uuid[]));

-- success_measure_entries_select_portfolio (SELECT) admits: any portfolio_admin.
drop policy if exists success_measure_entries_select_portfolio on public.success_measure_entries;
create policy success_measure_entries_select_portfolio on public.success_measure_entries
  for select to authenticated
  using ((select public.is_portfolio_admin()));

-- success_measures_select_by_function (SELECT) admits: a system admin; anyone whose own company is the row's company.
drop policy if exists success_measures_select_by_function on public.success_measures;
create policy success_measures_select_by_function on public.success_measures
  for select to authenticated
  using (
    (select public.auth_role()) = 'system_admin'
    or ((select public.auth_company_id()) is not null and (select public.auth_company_id()) = company_id)
  );

-- success_measures_select_by_function_guide (SELECT) admits: an assigned aims_guide or an assigned portfolio_admin.
drop policy if exists success_measures_select_by_function_guide on public.success_measures;
create policy success_measures_select_by_function_guide on public.success_measures
  for select to authenticated
  using (company_id = any ((select public.admin_company_ids())::uuid[]));

-- success_measures_select_portfolio (SELECT) admits: any portfolio_admin.
drop policy if exists success_measures_select_portfolio on public.success_measures;
create policy success_measures_select_portfolio on public.success_measures
  for select to authenticated
  using ((select public.is_portfolio_admin()));

-- ---- d. the write rules, one per command, expressions unchanged ------------

drop policy if exists success_measure_entries_write on public.success_measure_entries;
-- success_measure_entries_insert (INSERT) admits: a system admin; the company's company_admin; the function's lead or tracker.
create policy success_measure_entries_insert on public.success_measure_entries
  for insert to authenticated
  with check (exists (
    select 1 from public.success_measures m join public.functions f on f.id = m.function_id
     where m.id = success_measure_entries.measure_id
       and ((select public.auth_role()) = 'system_admin'
         or ((select public.auth_role()) = 'company_admin' and (select public.auth_company_id()) = f.company_id)
         or f.lead_id = (select auth.uid())
         or f.track_id = (select auth.uid()))));
-- success_measure_entries_update (UPDATE) admits: a system admin; the company's company_admin; the function's lead or tracker.
create policy success_measure_entries_update on public.success_measure_entries
  for update to authenticated
  using (exists (
    select 1 from public.success_measures m join public.functions f on f.id = m.function_id
     where m.id = success_measure_entries.measure_id
       and ((select public.auth_role()) = 'system_admin'
         or ((select public.auth_role()) = 'company_admin' and (select public.auth_company_id()) = f.company_id)
         or f.lead_id = (select auth.uid())
         or f.track_id = (select auth.uid()))))
  with check (exists (
    select 1 from public.success_measures m join public.functions f on f.id = m.function_id
     where m.id = success_measure_entries.measure_id
       and ((select public.auth_role()) = 'system_admin'
         or ((select public.auth_role()) = 'company_admin' and (select public.auth_company_id()) = f.company_id)
         or f.lead_id = (select auth.uid())
         or f.track_id = (select auth.uid()))));
-- success_measure_entries_delete (DELETE) admits: a system admin; the company's company_admin; the function's lead or tracker.
create policy success_measure_entries_delete on public.success_measure_entries
  for delete to authenticated
  using (exists (
    select 1 from public.success_measures m join public.functions f on f.id = m.function_id
     where m.id = success_measure_entries.measure_id
       and ((select public.auth_role()) = 'system_admin'
         or ((select public.auth_role()) = 'company_admin' and (select public.auth_company_id()) = f.company_id)
         or f.lead_id = (select auth.uid())
         or f.track_id = (select auth.uid()))));

drop policy if exists success_measure_entries_write_guide on public.success_measure_entries;
-- success_measure_entries_insert_guide (INSERT) admits: an assigned aims_guide or a switched-on portfolio admin.
create policy success_measure_entries_insert_guide on public.success_measure_entries
  for insert to authenticated
  with check (exists (
    select 1 from public.success_measures sm join public.functions f on f.id = sm.function_id
     where sm.id = success_measure_entries.measure_id and public.is_content_admin_for(f.company_id)));
-- success_measure_entries_update_guide (UPDATE) admits: an assigned aims_guide or a switched-on portfolio admin.
create policy success_measure_entries_update_guide on public.success_measure_entries
  for update to authenticated
  using (exists (
    select 1 from public.success_measures sm join public.functions f on f.id = sm.function_id
     where sm.id = success_measure_entries.measure_id and public.is_content_admin_for(f.company_id)))
  with check (exists (
    select 1 from public.success_measures sm join public.functions f on f.id = sm.function_id
     where sm.id = success_measure_entries.measure_id and public.is_content_admin_for(f.company_id)));
-- success_measure_entries_delete_guide (DELETE) admits: an assigned aims_guide or a switched-on portfolio admin.
create policy success_measure_entries_delete_guide on public.success_measure_entries
  for delete to authenticated
  using (exists (
    select 1 from public.success_measures sm join public.functions f on f.id = sm.function_id
     where sm.id = success_measure_entries.measure_id and public.is_content_admin_for(f.company_id)));

drop policy if exists success_measures_write_by_function on public.success_measures;
-- success_measures_insert_by_function (INSERT) admits: a system admin; the company's company_admin; the function's lead.
create policy success_measures_insert_by_function on public.success_measures
  for insert to authenticated
  with check (exists (
    select 1 from public.functions f
     where f.id = success_measures.function_id
       and ((select public.auth_role()) = 'system_admin'
         or ((select public.auth_role()) = 'company_admin' and (select public.auth_company_id()) = f.company_id)
         or f.lead_id = (select auth.uid()))));
-- success_measures_update_by_function (UPDATE) admits: a system admin; the company's company_admin; the function's lead.
create policy success_measures_update_by_function on public.success_measures
  for update to authenticated
  using (exists (
    select 1 from public.functions f
     where f.id = success_measures.function_id
       and ((select public.auth_role()) = 'system_admin'
         or ((select public.auth_role()) = 'company_admin' and (select public.auth_company_id()) = f.company_id)
         or f.lead_id = (select auth.uid()))))
  with check (exists (
    select 1 from public.functions f
     where f.id = success_measures.function_id
       and ((select public.auth_role()) = 'system_admin'
         or ((select public.auth_role()) = 'company_admin' and (select public.auth_company_id()) = f.company_id)
         or f.lead_id = (select auth.uid()))));
-- success_measures_delete_by_function (DELETE) admits: a system admin; the company's company_admin; the function's lead.
create policy success_measures_delete_by_function on public.success_measures
  for delete to authenticated
  using (exists (
    select 1 from public.functions f
     where f.id = success_measures.function_id
       and ((select public.auth_role()) = 'system_admin'
         or ((select public.auth_role()) = 'company_admin' and (select public.auth_company_id()) = f.company_id)
         or f.lead_id = (select auth.uid()))));

drop policy if exists success_measures_write_by_function_guide on public.success_measures;
-- success_measures_insert_by_function_guide (INSERT) admits: an assigned aims_guide or a switched-on portfolio admin.
create policy success_measures_insert_by_function_guide on public.success_measures
  for insert to authenticated
  with check (exists (
    select 1 from public.functions f
     where f.id = success_measures.function_id and public.is_content_admin_for(f.company_id)));
-- success_measures_update_by_function_guide (UPDATE) admits: an assigned aims_guide or a switched-on portfolio admin.
create policy success_measures_update_by_function_guide on public.success_measures
  for update to authenticated
  using (exists (
    select 1 from public.functions f
     where f.id = success_measures.function_id and public.is_content_admin_for(f.company_id)))
  with check (exists (
    select 1 from public.functions f
     where f.id = success_measures.function_id and public.is_content_admin_for(f.company_id)));
-- success_measures_delete_by_function_guide (DELETE) admits: an assigned aims_guide or a switched-on portfolio admin.
create policy success_measures_delete_by_function_guide on public.success_measures
  for delete to authenticated
  using (exists (
    select 1 from public.functions f
     where f.id = success_measures.function_id and public.is_content_admin_for(f.company_id)));
