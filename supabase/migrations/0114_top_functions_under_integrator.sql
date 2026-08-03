-- =============================================================
-- Migration 0114: reparent existing top-level functions under
-- Integrator
--
-- Follows 0113. Every function that is still parent-less AFTER
-- Integrator has been placed under Visionary belongs under
-- Integrator — the org-chart shape is:
--     Visionary
--       └─ Integrator
--            ├─ every other function that was previously at the top
--            └─ (…their children unchanged)
--
-- Per-company:
--   * Find that company's Integrator (a child of Visionary, titled
--     'Integrator', case-insensitive).
--   * For every OTHER top-level function in that company (parent
--     is null AND title is neither 'Visionary' nor 'Integrator'),
--     set parent_function_id to Integrator's id.
-- =============================================================

with integrators as (
  select
    i.company_id,
    i.id as integrator_id
  from public.functions i
  join public.functions v
    on v.id = i.parent_function_id
   and v.parent_function_id is null
   and lower(v.title) = 'visionary'
  where lower(i.title) = 'integrator'
)
update public.functions f
set parent_function_id = integrators.integrator_id
from integrators
where f.company_id = integrators.company_id
  and f.parent_function_id is null
  and lower(f.title) not in ('visionary', 'integrator');
