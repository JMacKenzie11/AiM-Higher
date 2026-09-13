-- =============================================================
-- Migration 0182: F8 batch 6a — the chart detail and role
-- description tables.
--
-- function_roles, function_competencies, function_decision_rights,
-- functional_areas, role_description_documents,
-- role_description_versions. Twenty-three policies; the _guide
-- policies are untouched.
--
-- BATCH 6 WAS SPLIT. The plan's batch 6 is "everything remaining",
-- which measured 42 tables and 115 policies — four times the largest
-- batch so far, and against the plan's own rule that a batch is sized
-- so its EXPLAIN story stays readable. It ships as 6a through 6f in
-- the sizes batches 1-5 used. profiles goes last, in 6f, alone with
-- guide_assignments and the entitlement tables: it is the table
-- auth_profile() itself reads, and it holds the schema's only
-- remaining IS NOT DISTINCT FROM, allowlisted by the static check.
--
-- FIVE OF THE SIX TABLES REACH company_id THROUGH functions, by
-- function_id. That join stays; what leaves the per-row loop is
-- auth_profile, which today is dragged into it by
-- `from auth_profile() ap join functions f on ...` — a join whose
-- left side is a set-returning function called once per row of the
-- table being filtered. functional_areas carries its own company_id
-- and needs no join at all.
--
-- THE is_default GUARD ON function_roles IS PRESERVED, outside the
-- EXISTS where it sits today: a default role may not be edited or
-- deleted by anyone, admin or not, and that clause is the whole of
-- it. It is not part of the tenant predicate and this migration does
-- not touch it.
--
-- Form D throughout. The `is not null` guards stay where they are.
-- =============================================================

-- ---- function_roles ----------------------------------

drop policy if exists function_roles_select on public.function_roles;
create policy function_roles_select on public.function_roles
for select to authenticated
using (
  exists (
    select 1 from public.functions f
    where f.id = public.function_roles.function_id
      and (
        (select public.auth_role()) = 'system_admin'
        or (
          (select public.auth_company_id()) is not null
          and (select public.auth_company_id()) = f.company_id
        )
      )
  )
);

drop policy if exists function_roles_insert on public.function_roles;
create policy function_roles_insert on public.function_roles
for insert to authenticated
with check (
  exists (
    select 1 from public.functions f
    where f.id = public.function_roles.function_id
      and (
        (select public.auth_role()) = 'system_admin'
        or (
          (select public.auth_role()) = 'company_admin'
          and (select public.auth_company_id()) = f.company_id
        )
      )
  )
);
drop policy if exists function_roles_update on public.function_roles;
create policy function_roles_update on public.function_roles
for update to authenticated
using (
  public.function_roles.is_default = false
  and (
    exists (
      select 1 from public.functions f
      where f.id = public.function_roles.function_id
        and (
          (select public.auth_role()) = 'system_admin'
          or (
            (select public.auth_role()) = 'company_admin'
            and (select public.auth_company_id()) = f.company_id
          )
        )
    )
  )
)
with check (
  public.function_roles.is_default = false
  and (
    exists (
      select 1 from public.functions f
      where f.id = public.function_roles.function_id
        and (
          (select public.auth_role()) = 'system_admin'
          or (
            (select public.auth_role()) = 'company_admin'
            and (select public.auth_company_id()) = f.company_id
          )
        )
    )
  )
);
drop policy if exists function_roles_delete on public.function_roles;
create policy function_roles_delete on public.function_roles
for delete to authenticated
using (
  public.function_roles.is_default = false
  and (
    exists (
      select 1 from public.functions f
      where f.id = public.function_roles.function_id
        and (
          (select public.auth_role()) = 'system_admin'
          or (
            (select public.auth_role()) = 'company_admin'
            and (select public.auth_company_id()) = f.company_id
          )
        )
    )
  )
);

-- ---- function_competencies ---------------------------

drop policy if exists function_competencies_select on public.function_competencies;
create policy function_competencies_select on public.function_competencies
for select to authenticated
using (
  exists (
    select 1 from public.functions f
    where f.id = public.function_competencies.function_id
      and (
        (select public.auth_role()) = 'system_admin'
        or (
          (select public.auth_company_id()) is not null
          and (select public.auth_company_id()) = f.company_id
        )
      )
  )
);

drop policy if exists function_competencies_insert on public.function_competencies;
create policy function_competencies_insert on public.function_competencies
for insert to authenticated
with check (
  exists (
    select 1 from public.functions f
    where f.id = public.function_competencies.function_id
      and (
        (select public.auth_role()) = 'system_admin'
        or (
          (select public.auth_role()) = 'company_admin'
          and (select public.auth_company_id()) = f.company_id
        )
      )
  )
);
drop policy if exists function_competencies_update on public.function_competencies;
create policy function_competencies_update on public.function_competencies
for update to authenticated
using (
  exists (
    select 1 from public.functions f
    where f.id = public.function_competencies.function_id
      and (
        (select public.auth_role()) = 'system_admin'
        or (
          (select public.auth_role()) = 'company_admin'
          and (select public.auth_company_id()) = f.company_id
        )
      )
  )
)
with check (
  exists (
    select 1 from public.functions f
    where f.id = public.function_competencies.function_id
      and (
        (select public.auth_role()) = 'system_admin'
        or (
          (select public.auth_role()) = 'company_admin'
          and (select public.auth_company_id()) = f.company_id
        )
      )
  )
);
drop policy if exists function_competencies_delete on public.function_competencies;
create policy function_competencies_delete on public.function_competencies
for delete to authenticated
using (
  exists (
    select 1 from public.functions f
    where f.id = public.function_competencies.function_id
      and (
        (select public.auth_role()) = 'system_admin'
        or (
          (select public.auth_role()) = 'company_admin'
          and (select public.auth_company_id()) = f.company_id
        )
      )
  )
);

-- ---- function_decision_rights ------------------------

drop policy if exists function_decision_rights_select on public.function_decision_rights;
create policy function_decision_rights_select on public.function_decision_rights
for select to authenticated
using (
  exists (
    select 1 from public.functions f
    where f.id = public.function_decision_rights.function_id
      and (
        (select public.auth_role()) = 'system_admin'
        or (
          (select public.auth_company_id()) is not null
          and (select public.auth_company_id()) = f.company_id
        )
      )
  )
);

drop policy if exists function_decision_rights_insert on public.function_decision_rights;
create policy function_decision_rights_insert on public.function_decision_rights
for insert to authenticated
with check (
  exists (
    select 1 from public.functions f
    where f.id = public.function_decision_rights.function_id
      and (
        (select public.auth_role()) = 'system_admin'
        or (
          (select public.auth_role()) = 'company_admin'
          and (select public.auth_company_id()) = f.company_id
        )
      )
  )
);
drop policy if exists function_decision_rights_update on public.function_decision_rights;
create policy function_decision_rights_update on public.function_decision_rights
for update to authenticated
using (
  exists (
    select 1 from public.functions f
    where f.id = public.function_decision_rights.function_id
      and (
        (select public.auth_role()) = 'system_admin'
        or (
          (select public.auth_role()) = 'company_admin'
          and (select public.auth_company_id()) = f.company_id
        )
      )
  )
)
with check (
  exists (
    select 1 from public.functions f
    where f.id = public.function_decision_rights.function_id
      and (
        (select public.auth_role()) = 'system_admin'
        or (
          (select public.auth_role()) = 'company_admin'
          and (select public.auth_company_id()) = f.company_id
        )
      )
  )
);
drop policy if exists function_decision_rights_delete on public.function_decision_rights;
create policy function_decision_rights_delete on public.function_decision_rights
for delete to authenticated
using (
  exists (
    select 1 from public.functions f
    where f.id = public.function_decision_rights.function_id
      and (
        (select public.auth_role()) = 'system_admin'
        or (
          (select public.auth_role()) = 'company_admin'
          and (select public.auth_company_id()) = f.company_id
        )
      )
  )
);

-- ---- functional_areas --------------------------------

drop policy if exists functional_areas_select on public.functional_areas;
create policy functional_areas_select on public.functional_areas
for select to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_company_id()) is not null
    and (select public.auth_company_id()) = public.functional_areas.company_id
  )
);

drop policy if exists functional_areas_insert on public.functional_areas;
create policy functional_areas_insert on public.functional_areas
for insert to authenticated
with check (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.functional_areas.company_id
  )
);
drop policy if exists functional_areas_update on public.functional_areas;
create policy functional_areas_update on public.functional_areas
for update to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.functional_areas.company_id
  )
)
with check (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.functional_areas.company_id
  )
);
drop policy if exists functional_areas_delete on public.functional_areas;
create policy functional_areas_delete on public.functional_areas
for delete to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.functional_areas.company_id
  )
);

-- ---- role_description_documents ----------------------

drop policy if exists role_description_documents_select on public.role_description_documents;
create policy role_description_documents_select on public.role_description_documents
for select to authenticated
using (
  exists (
    select 1 from public.functions f
    where f.id = public.role_description_documents.function_id
      and (
        (select public.auth_role()) = 'system_admin'
        or (
          (select public.auth_company_id()) is not null
          and (select public.auth_company_id()) = f.company_id
        )
      )
  )
);

drop policy if exists role_description_documents_insert on public.role_description_documents;
create policy role_description_documents_insert on public.role_description_documents
for insert to authenticated
with check (
  exists (
    select 1 from public.functions f
    where f.id = public.role_description_documents.function_id
      and (
        (select public.auth_role()) = 'system_admin'
        or (
          (select public.auth_role()) = 'company_admin'
          and (select public.auth_company_id()) = f.company_id
        )
      )
  )
);
drop policy if exists role_description_documents_update on public.role_description_documents;
create policy role_description_documents_update on public.role_description_documents
for update to authenticated
using (
  exists (
    select 1 from public.functions f
    where f.id = public.role_description_documents.function_id
      and (
        (select public.auth_role()) = 'system_admin'
        or (
          (select public.auth_role()) = 'company_admin'
          and (select public.auth_company_id()) = f.company_id
        )
      )
  )
)
with check (
  exists (
    select 1 from public.functions f
    where f.id = public.role_description_documents.function_id
      and (
        (select public.auth_role()) = 'system_admin'
        or (
          (select public.auth_role()) = 'company_admin'
          and (select public.auth_company_id()) = f.company_id
        )
      )
  )
);
drop policy if exists role_description_documents_delete on public.role_description_documents;
create policy role_description_documents_delete on public.role_description_documents
for delete to authenticated
using (
  exists (
    select 1 from public.functions f
    where f.id = public.role_description_documents.function_id
      and (
        (select public.auth_role()) = 'system_admin'
        or (
          (select public.auth_role()) = 'company_admin'
          and (select public.auth_company_id()) = f.company_id
        )
      )
  )
);

-- ---- role_description_versions -----------------------

drop policy if exists role_description_versions_select on public.role_description_versions;
create policy role_description_versions_select on public.role_description_versions
for select to authenticated
using (
  exists (
    select 1 from public.functions f
    where f.id = public.role_description_versions.function_id
      and (
        (select public.auth_role()) = 'system_admin'
        or (
          (select public.auth_company_id()) is not null
          and (select public.auth_company_id()) = f.company_id
        )
      )
  )
);

drop policy if exists role_description_versions_insert on public.role_description_versions;
create policy role_description_versions_insert on public.role_description_versions
for insert to authenticated
with check (
  exists (
    select 1 from public.functions f
    where f.id = public.role_description_versions.function_id
      and (
        (select public.auth_role()) = 'system_admin'
        or (
          (select public.auth_role()) = 'company_admin'
          and (select public.auth_company_id()) = f.company_id
        )
      )
  )
);
drop policy if exists role_description_versions_delete on public.role_description_versions;
create policy role_description_versions_delete on public.role_description_versions
for delete to authenticated
using (
  exists (
    select 1 from public.functions f
    where f.id = public.role_description_versions.function_id
      and (
        (select public.auth_role()) = 'system_admin'
        or (
          (select public.auth_role()) = 'company_admin'
          and (select public.auth_company_id()) = f.company_id
        )
      )
  )
);
