-- 0274: a function's Lead is its only seat. The separate Tracker no
-- longer writes measure values.
--
-- WHY. Jason, 2026-10-14: Lead, Track and Decide are not separate
-- seats. Every functional Lead does all three, and the separate roles
-- left the UI a while ago. The entry rules on success_measure_entries
-- (0020, carried through 0168, 0179 and 0247) still admitted
-- `functions.track_id` as a second writer. Nothing in the app sets that
-- column, so it reached only rows that already carried one: on
-- 2026-10-14, two functions on production (one where the Tracker is not
-- the Lead, a team member in Meridian Construction Group's Field
-- Operations) and none on PromiseOne.
--
-- WHAT. The three entry rules from 0247, unchanged except that the
-- `or f.track_id = (select auth.uid())` branch is gone. Who may write a
-- measure's values is now who may author the measure
-- (success_measures_write_by_function, 0217): a system admin, the
-- company's company_admin, the function's Lead; plus the _guide rules
-- beside these, which this does not touch. Values a Tracker already
-- entered stay, with their entered_by.
--
-- The assistant rule on these values (assistant_insert, 0270) never read
-- track_id; it sits on top of these rules, so it narrows with them. Its
-- stored comment is corrected below.
--
-- The columns stay for now: the running app still selects track_id
-- until this release is everywhere. Dropping track_id and decide_id
-- (and their indexes) is Step 2, a later migration on Jason's go.

drop policy if exists success_measure_entries_insert on public.success_measure_entries;
-- success_measure_entries_insert (INSERT) admits: a system admin; the company's company_admin; the function's Lead.
create policy success_measure_entries_insert on public.success_measure_entries
  for insert to authenticated
  with check (exists (
    select 1 from public.success_measures m join public.functions f on f.id = m.function_id
     where m.id = success_measure_entries.measure_id
       and ((select public.auth_role()) = 'system_admin'
         or ((select public.auth_role()) = 'company_admin' and (select public.auth_company_id()) = f.company_id)
         or f.lead_id = (select auth.uid()))));

drop policy if exists success_measure_entries_update on public.success_measure_entries;
-- success_measure_entries_update (UPDATE) admits: a system admin; the company's company_admin; the function's Lead.
create policy success_measure_entries_update on public.success_measure_entries
  for update to authenticated
  using (exists (
    select 1 from public.success_measures m join public.functions f on f.id = m.function_id
     where m.id = success_measure_entries.measure_id
       and ((select public.auth_role()) = 'system_admin'
         or ((select public.auth_role()) = 'company_admin' and (select public.auth_company_id()) = f.company_id)
         or f.lead_id = (select auth.uid()))))
  with check (exists (
    select 1 from public.success_measures m join public.functions f on f.id = m.function_id
     where m.id = success_measure_entries.measure_id
       and ((select public.auth_role()) = 'system_admin'
         or ((select public.auth_role()) = 'company_admin' and (select public.auth_company_id()) = f.company_id)
         or f.lead_id = (select auth.uid()))));

drop policy if exists success_measure_entries_delete on public.success_measure_entries;
-- success_measure_entries_delete (DELETE) admits: a system admin; the company's company_admin; the function's Lead.
create policy success_measure_entries_delete on public.success_measure_entries
  for delete to authenticated
  using (exists (
    select 1 from public.success_measures m join public.functions f on f.id = m.function_id
     where m.id = success_measure_entries.measure_id
       and ((select public.auth_role()) = 'system_admin'
         or ((select public.auth_role()) = 'company_admin' and (select public.auth_company_id()) = f.company_id)
         or f.lead_id = (select auth.uid()))));

comment on policy assistant_insert on public.success_measure_entries is
  'An outside assistant adds a typed value (never a pull) for someone who may write the measure: '
  'a system admin, the company''s company_admin, an assigned guide, or the function''s Lead (0270, 0274). '
  'No update rule, so never over an existing week.';

comment on column public.functions.track_id is
  'Retired (0274): the Lead holds Lead, Track and Decide. Nothing reads it; dropped in a later migration.';
comment on column public.functions.decide_id is
  'Retired (0274): the Lead holds Lead, Track and Decide. Nothing reads it; dropped in a later migration.';
