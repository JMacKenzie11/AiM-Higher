-- =============================================================
-- Migration 0163: repair priority_progress.
--
-- The view has been wrong since migration 0139 renamed the
-- commitment statuses. It still counts status = 'kept' (replaced by
-- kept_on_time / kept_late in 0139) and status = 'carried' (dropped
-- back in 0011). Neither value exists on any row, so:
--
--   * kept_count was always 0, which made percent always 0. Every
--     priority, and by rollup every annual goal, every strategic
--     focus area, and the Execution figure on /dashboard, has been
--     displaying 0% for every company.
--   * commitment_count (computed app-side as kept + open + missed +
--     carried) was really just open + missed, so a priority whose
--     work was finished reported zero commitments.
--
-- Second, unrelated defect fixed here: the view never excluded
-- soft-deleted or parked commitments. Migration 0139 added
-- deleted_at and parked_at, and every UI surface filters them out,
-- but this view counted them — so a priority could report "3
-- commitments" while the page below it showed 1.
--
-- SEMANTIC DECISION worth reading before you ship this.
-- kept_count now covers kept_on_time AND kept_late, i.e. "the work
-- got done". Rationale: 0139 mapped old 'kept' → kept_on_time and
-- old 'missed' WITH a completed_at → kept_late, because those rows
-- were finished work mislabelled as misses. Progress on a priority
-- means work completed, so a late completion counts. This is
-- deliberately NOT the same rule as follow-through rate
-- (computeFollowThroughRate), which is on-time only and measures
-- discipline rather than progress. Two different questions, two
-- different numerators.
--
-- carried_count is retained as a literal 0 so PriorityProgressRow
-- and its consumers keep their shape. The status it counted has not
-- existed since 0011.
-- =============================================================

create or replace view public.priority_progress as
select
  p.id            as priority_id,
  p.company_id,
  p.status,
  p.archived,
  coalesce(
    sum(case when c.status in ('kept_on_time', 'kept_late') then 1 else 0 end),
    0
  )               as kept_count,
  coalesce(sum(case when c.status = 'open'   then 1 else 0 end), 0) as open_count,
  coalesce(sum(case when c.status = 'missed' then 1 else 0 end), 0) as missed_count,
  -- Vestigial: 'carried' was dropped in migration 0011. Kept in the
  -- projection so the row shape stays stable for existing callers.
  0               as carried_count,
  count(c.id)     as denominator,
  case
    when p.status = 'complete' then 100
    when count(c.id) = 0 then null
    else round(
      100.0
      * sum(
          case when c.status in ('kept_on_time', 'kept_late') then 1 else 0 end
        )::numeric
      / nullif(count(c.id), 0)::numeric
    )::int
  end             as percent
from public.priorities p
-- Join condition, NOT a where clause: a priority with no live
-- commitments must still produce a row (with percent null), which an
-- inner filter would drop entirely.
left join public.commitments c
  on c.priority_id = p.id
  and c.deleted_at is null
  and c.parked_at is null
group by p.id;

-- security_invoker must be re-asserted: CREATE OR REPLACE VIEW does
-- not preserve it, and without it the view runs as its owner and
-- bypasses RLS. That would be a cross-tenant read, not a cosmetic
-- regression. See the same note in migration 0007.
alter view public.priority_progress set (security_invoker = on);

-- annual_goal_progress and sfa_progress average priority_progress.percent
-- and need no change of their own; they were only ever wrong because
-- their input was.
