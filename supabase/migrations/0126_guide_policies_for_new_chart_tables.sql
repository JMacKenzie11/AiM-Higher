-- =============================================================
-- Migration 0126 — guide RLS policies for the two new chart tables
--
-- Migrations 0124 and 0125 added function_decision_rights and
-- function_competencies with company_admin-scoped RLS but no
-- aims_guide equivalent — a drift from the guides-as-company-admins
-- policy established in 0111_aims_guide.sql. This migration closes
-- that gap: for both tables, add a mirror _guide policy that
-- authorises an aims_guide with an assignment to the row's company
-- using the existing is_guide_for() helper.
--
-- With these in place, the Role Description interview (and any
-- direct chart edit of Decision Rights / Competency Indicators)
-- works for aims_guide, matching how every other chart table
-- treats guides.
-- =============================================================

-- ---- function_decision_rights ---------------------------------
drop policy if exists function_decision_rights_insert_guide
  on public.function_decision_rights;
create policy function_decision_rights_insert_guide
  on public.function_decision_rights
for insert to authenticated
with check (
  public.is_guide_for(
    (select company_id from public.functions
      where id = public.function_decision_rights.function_id)
  )
);

drop policy if exists function_decision_rights_update_guide
  on public.function_decision_rights;
create policy function_decision_rights_update_guide
  on public.function_decision_rights
for update to authenticated
using (
  public.is_guide_for(
    (select company_id from public.functions
      where id = public.function_decision_rights.function_id)
  )
)
with check (
  public.is_guide_for(
    (select company_id from public.functions
      where id = public.function_decision_rights.function_id)
  )
);

drop policy if exists function_decision_rights_delete_guide
  on public.function_decision_rights;
create policy function_decision_rights_delete_guide
  on public.function_decision_rights
for delete to authenticated
using (
  public.is_guide_for(
    (select company_id from public.functions
      where id = public.function_decision_rights.function_id)
  )
);

-- ---- function_competencies ------------------------------------
drop policy if exists function_competencies_insert_guide
  on public.function_competencies;
create policy function_competencies_insert_guide
  on public.function_competencies
for insert to authenticated
with check (
  public.is_guide_for(
    (select company_id from public.functions
      where id = public.function_competencies.function_id)
  )
);

drop policy if exists function_competencies_update_guide
  on public.function_competencies;
create policy function_competencies_update_guide
  on public.function_competencies
for update to authenticated
using (
  public.is_guide_for(
    (select company_id from public.functions
      where id = public.function_competencies.function_id)
  )
)
with check (
  public.is_guide_for(
    (select company_id from public.functions
      where id = public.function_competencies.function_id)
  )
);

drop policy if exists function_competencies_delete_guide
  on public.function_competencies;
create policy function_competencies_delete_guide
  on public.function_competencies
for delete to authenticated
using (
  public.is_guide_for(
    (select company_id from public.functions
      where id = public.function_competencies.function_id)
  )
);
