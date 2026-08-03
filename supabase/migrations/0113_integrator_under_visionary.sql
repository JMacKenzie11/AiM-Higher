-- =============================================================
-- Migration 0113: reparent Integrator under Visionary
--
-- The prior seed (migration 0112 + createCompanyAction) placed
-- both Visionary and Integrator as top-level functions. The correct
-- shape is Visionary at the root with Integrator reporting to it,
-- so downstream functions have a clear "who do I ladder up under"
-- question with only these two answers on a brand-new chart.
--
-- Per-company:
--   * If both Visionary and Integrator exist as top-level rows,
--     move Integrator underneath Visionary and reset its sort_order.
--   * If only Integrator exists at the top (Visionary was renamed
--     or missing), leave it alone — the operator's chart has drifted
--     from defaults and we don't want to guess.
-- =============================================================

with pairs as (
  select
    v.company_id,
    v.id as visionary_id,
    i.id as integrator_id
  from public.functions v
  join public.functions i
    on i.company_id = v.company_id
   and i.parent_function_id is null
   and lower(i.title) = 'integrator'
  where v.parent_function_id is null
    and lower(v.title) = 'visionary'
)
update public.functions f
set parent_function_id = pairs.visionary_id,
    sort_order = 0
from pairs
where f.id = pairs.integrator_id;
