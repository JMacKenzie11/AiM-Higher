-- =============================================================
-- Migration 0183: F8 batch 6b — foundation, marketing, scorecard.
--
-- company_foundation, foundation_items, marketing_strategy,
-- marketing_snippets, messaging_pillars, scorecard_metrics,
-- scorecard_entries. Twenty-eight policies; the _guide policies are
-- untouched.
--
-- The most regular batch in the series: every table carries its own
-- company_id and twenty-six of the twenty-eight policies are one of
-- four shapes. Transcribed with ap.role -> (select public.auth_role()),
-- ap.company_id -> (select public.auth_company_id()) and
-- ap.uid -> (select auth.uid()).
--
-- THE EXCEPTION IS scorecard_entries, WHOSE INSERT AND UPDATE ADMIT A
-- THIRD CALLER: the person accountable for the functional area the
-- metric belongs to. Whoever owns an area may record its numbers
-- without being an admin of anything, which is the same rule
-- success_measure_entries carries for a function's lead in batch 4,
-- reached by a different path:
--
--   scorecard_entries -> scorecard_metrics -> functional_areas.accountable_id
--
-- That EXISTS stays; it is a traversal to the row that grants the
-- right, not a helper call. What leaves the loop is auth_profile, and
-- ap.uid inside the traversal becomes (select auth.uid()). The branch
-- is probed as a real accountable person in this batch's report.
--
-- Form D throughout. The `is not null` guards stay where they are.
-- =============================================================

-- ---- company_foundation --------------------------------

drop policy if exists company_foundation_select on public.company_foundation;
create policy company_foundation_select on public.company_foundation
for select to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_company_id()) is not null
    and (select public.auth_company_id()) = public.company_foundation.company_id
  )
);

drop policy if exists company_foundation_insert on public.company_foundation;
create policy company_foundation_insert on public.company_foundation
for insert to authenticated
with check (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.company_foundation.company_id
  )
);

drop policy if exists company_foundation_update on public.company_foundation;
create policy company_foundation_update on public.company_foundation
for update to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.company_foundation.company_id
  )
)
with check (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.company_foundation.company_id
  )
);

drop policy if exists company_foundation_delete on public.company_foundation;
create policy company_foundation_delete on public.company_foundation
for delete to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.company_foundation.company_id
  )
);

-- ---- foundation_items ----------------------------------

drop policy if exists foundation_items_select on public.foundation_items;
create policy foundation_items_select on public.foundation_items
for select to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_company_id()) is not null
    and (select public.auth_company_id()) = public.foundation_items.company_id
  )
);

drop policy if exists foundation_items_insert on public.foundation_items;
create policy foundation_items_insert on public.foundation_items
for insert to authenticated
with check (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.foundation_items.company_id
  )
);

drop policy if exists foundation_items_update on public.foundation_items;
create policy foundation_items_update on public.foundation_items
for update to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.foundation_items.company_id
  )
)
with check (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.foundation_items.company_id
  )
);

drop policy if exists foundation_items_delete on public.foundation_items;
create policy foundation_items_delete on public.foundation_items
for delete to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.foundation_items.company_id
  )
);

-- ---- marketing_strategy --------------------------------

drop policy if exists marketing_strategy_select on public.marketing_strategy;
create policy marketing_strategy_select on public.marketing_strategy
for select to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_company_id()) is not null
    and (select public.auth_company_id()) = public.marketing_strategy.company_id
  )
);

drop policy if exists marketing_strategy_insert on public.marketing_strategy;
create policy marketing_strategy_insert on public.marketing_strategy
for insert to authenticated
with check (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.marketing_strategy.company_id
  )
);

drop policy if exists marketing_strategy_update on public.marketing_strategy;
create policy marketing_strategy_update on public.marketing_strategy
for update to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.marketing_strategy.company_id
  )
)
with check (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.marketing_strategy.company_id
  )
);

drop policy if exists marketing_strategy_delete on public.marketing_strategy;
create policy marketing_strategy_delete on public.marketing_strategy
for delete to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.marketing_strategy.company_id
  )
);

-- ---- marketing_snippets --------------------------------

drop policy if exists marketing_snippets_select on public.marketing_snippets;
create policy marketing_snippets_select on public.marketing_snippets
for select to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_company_id()) is not null
    and (select public.auth_company_id()) = public.marketing_snippets.company_id
  )
);

drop policy if exists marketing_snippets_insert on public.marketing_snippets;
create policy marketing_snippets_insert on public.marketing_snippets
for insert to authenticated
with check (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.marketing_snippets.company_id
  )
);

drop policy if exists marketing_snippets_update on public.marketing_snippets;
create policy marketing_snippets_update on public.marketing_snippets
for update to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.marketing_snippets.company_id
  )
)
with check (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.marketing_snippets.company_id
  )
);

drop policy if exists marketing_snippets_delete on public.marketing_snippets;
create policy marketing_snippets_delete on public.marketing_snippets
for delete to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.marketing_snippets.company_id
  )
);

-- ---- messaging_pillars ---------------------------------

drop policy if exists messaging_pillars_select on public.messaging_pillars;
create policy messaging_pillars_select on public.messaging_pillars
for select to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_company_id()) is not null
    and (select public.auth_company_id()) = public.messaging_pillars.company_id
  )
);

drop policy if exists messaging_pillars_insert on public.messaging_pillars;
create policy messaging_pillars_insert on public.messaging_pillars
for insert to authenticated
with check (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.messaging_pillars.company_id
  )
);

drop policy if exists messaging_pillars_update on public.messaging_pillars;
create policy messaging_pillars_update on public.messaging_pillars
for update to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.messaging_pillars.company_id
  )
)
with check (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.messaging_pillars.company_id
  )
);

drop policy if exists messaging_pillars_delete on public.messaging_pillars;
create policy messaging_pillars_delete on public.messaging_pillars
for delete to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.messaging_pillars.company_id
  )
);

-- ---- scorecard_metrics ---------------------------------

drop policy if exists scorecard_metrics_select on public.scorecard_metrics;
create policy scorecard_metrics_select on public.scorecard_metrics
for select to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_company_id()) is not null
    and (select public.auth_company_id()) = public.scorecard_metrics.company_id
  )
);

drop policy if exists scorecard_metrics_insert on public.scorecard_metrics;
create policy scorecard_metrics_insert on public.scorecard_metrics
for insert to authenticated
with check (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.scorecard_metrics.company_id
  )
);

drop policy if exists scorecard_metrics_update on public.scorecard_metrics;
create policy scorecard_metrics_update on public.scorecard_metrics
for update to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.scorecard_metrics.company_id
  )
)
with check (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.scorecard_metrics.company_id
  )
);

drop policy if exists scorecard_metrics_delete on public.scorecard_metrics;
create policy scorecard_metrics_delete on public.scorecard_metrics
for delete to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.scorecard_metrics.company_id
  )
);

-- ---- scorecard_entries ---------------------------------

drop policy if exists scorecard_entries_select on public.scorecard_entries;
create policy scorecard_entries_select on public.scorecard_entries
for select to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_company_id()) is not null
    and (select public.auth_company_id()) = public.scorecard_entries.company_id
  )
);

drop policy if exists scorecard_entries_insert on public.scorecard_entries;
create policy scorecard_entries_insert on public.scorecard_entries
for insert to authenticated
with check (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.scorecard_entries.company_id
  )  or exists (
    select 1
    from public.scorecard_metrics m
    join public.functional_areas fa on fa.id = m.functional_area_id
    where m.id = public.scorecard_entries.metric_id
      and fa.accountable_id = (select auth.uid())
  )
);

drop policy if exists scorecard_entries_update on public.scorecard_entries;
create policy scorecard_entries_update on public.scorecard_entries
for update to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.scorecard_entries.company_id
  )  or exists (
    select 1
    from public.scorecard_metrics m
    join public.functional_areas fa on fa.id = m.functional_area_id
    where m.id = public.scorecard_entries.metric_id
      and fa.accountable_id = (select auth.uid())
  )
)
with check (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.scorecard_entries.company_id
  )  or exists (
    select 1
    from public.scorecard_metrics m
    join public.functional_areas fa on fa.id = m.functional_area_id
    where m.id = public.scorecard_entries.metric_id
      and fa.accountable_id = (select auth.uid())
  )
);

drop policy if exists scorecard_entries_delete on public.scorecard_entries;
create policy scorecard_entries_delete on public.scorecard_entries
for delete to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.scorecard_entries.company_id
  )
);
