-- =============================================================
-- Migration 0179: F8 batch 4 — the chart and measures tables.
--
-- functions, success_measures, success_measure_entries,
-- csf_kpi_links. Ten policies, transcribed from pg_policies on
-- production with:
--
--   ap.role        ->  (select public.auth_role())
--   ap.company_id  ->  (select public.auth_company_id())
--   ap.uid         ->  (select auth.uid())
--
-- The ten _guide policies are untouched.
--
-- THREE OF THESE TABLES HAVE NO company_id. They reach one through
-- functions, and the EXISTS that walks there stays exactly as it is:
-- it is a join to the parent, not a helper call. What comes out of
-- the per-row loop is auth_profile, which today is dragged into every
-- one of those joins by `join auth_profile() ap on (true)` — a cross
-- join evaluated once per row of the table being filtered.
--
--   success_measures        -> functions.company_id via function_id
--   success_measure_entries -> success_measures -> functions
--   csf_kpi_links           -> success_measures -> functions via csf_id
--
-- THE LEAD AND TRACK BRANCH. success_measure_entries_write admits
-- three kinds of caller: system_admin, the company's admin, and the
-- function's lead_id or track_id. That third one is this batch's
-- owner rule — the person accountable for a function may record its
-- numbers without being an admin of anything — and it is the reason
-- ap.uid appears here at all. Transcribed as (select auth.uid()) and
-- probed as a real lead in this batch's report.
--
-- Form D throughout. The `is not null` guards stay where they are.
-- =============================================================

-- ---- functions ------------------------------------------------

drop policy if exists functions_select on public.functions;
create policy functions_select on public.functions
for select to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_company_id()) is not null
    and (select public.auth_company_id()) = public.functions.company_id
  )
);

drop policy if exists functions_insert on public.functions;
create policy functions_insert on public.functions
for insert to authenticated
with check (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.functions.company_id
  )
);

drop policy if exists functions_update on public.functions;
create policy functions_update on public.functions
for update to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.functions.company_id
  )
)
with check (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.functions.company_id
  )
);

drop policy if exists functions_delete on public.functions;
create policy functions_delete on public.functions
for delete to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.functions.company_id
  )
);

-- ---- success_measures -----------------------------------------

drop policy if exists success_measures_select_by_function on public.success_measures;
create policy success_measures_select_by_function on public.success_measures
for select to authenticated
using (
  exists (
    select 1 from public.functions f
    where f.id = public.success_measures.function_id
      and (
        (select public.auth_role()) = 'system_admin'
        or (
          (select public.auth_company_id()) is not null
          and (select public.auth_company_id()) = f.company_id
        )
      )
  )
);

drop policy if exists success_measures_write_by_function on public.success_measures;
create policy success_measures_write_by_function on public.success_measures
for all to authenticated
using (
  exists (
    select 1 from public.functions f
    where f.id = public.success_measures.function_id
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
    where f.id = public.success_measures.function_id
      and (
        (select public.auth_role()) = 'system_admin'
        or (
          (select public.auth_role()) = 'company_admin'
          and (select public.auth_company_id()) = f.company_id
        )
      )
  )
);

-- ---- success_measure_entries ----------------------------------

drop policy if exists success_measure_entries_select on public.success_measure_entries;
create policy success_measure_entries_select on public.success_measure_entries
for select to authenticated
using (
  exists (
    select 1
    from public.success_measures m
    join public.functions f on f.id = m.function_id
    where m.id = public.success_measure_entries.measure_id
      and (
        (select public.auth_role()) = 'system_admin'
        or (
          (select public.auth_company_id()) is not null
          and (select public.auth_company_id()) = f.company_id
        )
      )
  )
);

-- The lead and track branch. See the header.
drop policy if exists success_measure_entries_write on public.success_measure_entries;
create policy success_measure_entries_write on public.success_measure_entries
for all to authenticated
using (
  exists (
    select 1
    from public.success_measures m
    join public.functions f on f.id = m.function_id
    where m.id = public.success_measure_entries.measure_id
      and (
        (select public.auth_role()) = 'system_admin'
        or (
          (select public.auth_role()) = 'company_admin'
          and (select public.auth_company_id()) = f.company_id
        )
        or f.lead_id = (select auth.uid())
        or f.track_id = (select auth.uid())
      )
  )
)
with check (
  exists (
    select 1
    from public.success_measures m
    join public.functions f on f.id = m.function_id
    where m.id = public.success_measure_entries.measure_id
      and (
        (select public.auth_role()) = 'system_admin'
        or (
          (select public.auth_role()) = 'company_admin'
          and (select public.auth_company_id()) = f.company_id
        )
        or f.lead_id = (select auth.uid())
        or f.track_id = (select auth.uid())
      )
  )
);

-- ---- csf_kpi_links --------------------------------------------

drop policy if exists csf_kpi_links_select on public.csf_kpi_links;
create policy csf_kpi_links_select on public.csf_kpi_links
for select to authenticated
using (
  exists (
    select 1
    from public.success_measures m
    join public.functions f on f.id = m.function_id
    where m.id = public.csf_kpi_links.csf_id
      and (
        (select public.auth_role()) = 'system_admin'
        or (
          (select public.auth_company_id()) is not null
          and (select public.auth_company_id()) = f.company_id
        )
      )
  )
);

drop policy if exists csf_kpi_links_write on public.csf_kpi_links;
create policy csf_kpi_links_write on public.csf_kpi_links
for all to authenticated
using (
  exists (
    select 1
    from public.success_measures m
    join public.functions f on f.id = m.function_id
    where m.id = public.csf_kpi_links.csf_id
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
    select 1
    from public.success_measures m
    join public.functions f on f.id = m.function_id
    where m.id = public.csf_kpi_links.csf_id
      and (
        (select public.auth_role()) = 'system_admin'
        or (
          (select public.auth_role()) = 'company_admin'
          and (select public.auth_company_id()) = f.company_id
        )
      )
  )
);
