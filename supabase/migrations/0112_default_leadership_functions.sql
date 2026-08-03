-- =============================================================
-- Migration 0112: seed Visionary + Integrator as default functions
--
-- Every company gets two top-level functions on the accountability
-- chart out of the gate: Visionary (CEO) and Integrator (COO). The
-- createCompanyAction now inserts them on new companies; this
-- backfills existing ones that don't already have either row.
--
-- Skip logic (per-company, case-insensitive on title):
--   * If a top-level function titled "Visionary" doesn't exist,
--     insert it.
--   * If a top-level function titled "Integrator" doesn't exist,
--     insert it.
-- Sort order: 0 for Visionary, 1 for Integrator, both above the
-- max existing top-level sort_order for that company so the chart
-- doesn't reshuffle if the company already ordered other boxes.
-- =============================================================

insert into public.functions
  (company_id, parent_function_id, title, description, sort_order)
select
  c.id,
  null,
  'Visionary',
  'CEO — sets the long-term vision, priorities and cultural tone.',
  coalesce(
    (
      select min(sort_order) - 2
      from public.functions f
      where f.company_id = c.id and f.parent_function_id is null
    ),
    0
  )
from public.companies c
where not exists (
  select 1 from public.functions f
  where f.company_id = c.id
    and f.parent_function_id is null
    and lower(f.title) = 'visionary'
);

insert into public.functions
  (company_id, parent_function_id, title, description, sort_order)
select
  c.id,
  null,
  'Integrator',
  'COO — turns the vision into execution across the leadership team.',
  coalesce(
    (
      select min(sort_order) - 1
      from public.functions f
      where f.company_id = c.id and f.parent_function_id is null
    ),
    1
  )
from public.companies c
where not exists (
  select 1 from public.functions f
  where f.company_id = c.id
    and f.parent_function_id is null
    and lower(f.title) = 'integrator'
);
