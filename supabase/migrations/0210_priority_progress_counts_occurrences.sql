-- =============================================================
-- Migration 0210: a kept week counts as progress.
--
-- priority_progress counts one unit per COMMITMENT ROW. An ongoing
-- commitment is one row for the whole cycle — migration 0140:
-- "the commitments row itself never leaves 'open' status while the
-- cycle is active, one row, many occurrences" — so a recurring
-- commitment that has been kept every week for a quarter counts as
-- exactly one open commitment and contributes nothing to kept_count.
--
-- A priority whose only commitment is a recurring one therefore sits
-- at 0% forever, however faithfully the team does the work. Three
-- Benson Seafood priorities are in that state today, and the shape
-- of the bug is the one 0163 fixed: a progress view counting
-- something that does not match how the data behaves.
--
-- 0140 already wrote the rule down for Follow-Through: "non-ongoing
-- resolved commitments contribute one entry each, ongoing rows
-- contribute one entry per occurrence." This view never got it. The
-- decision here is to apply the same rule: A KEPT WEEK IS PROGRESS,
-- ONE UNIT PER OCCURRENCE.
--
-- WHAT A UNIT IS NOW.
--
--   every live commitment row       one unit, bucketed by its status
--   every occurrence on one         one unit, bucketed by ITS status
--
-- Uniform, and it cannot double-count: resolving an ongoing
-- commitment writes an occurrence and leaves the parent open;
-- resolving a one-off updates the parent and writes no occurrence.
-- A resolution lands in exactly one of the two places.
--
-- Worked through:
--
--   one-off, kept            1 kept                     100%
--   ongoing, 2 kept weeks    1 open + 2 kept = 3 units   67%
--   ongoing, no weeks yet    1 open                       0%
--   stopped cycle, 2 kept    parent's own status + 2      -
--     weeks, then resolved   kept weeks
--
-- The last row is why the parent is counted uniformly rather than
-- skipped when is_ongoing. Stopping a cycle sets is_ongoing = false
-- and leaves status alone (stopOngoingCommitmentAction), so the row
-- becomes an ordinary commitment with real history behind it. Both
-- halves are real weeks of work and both should count.
--
-- NOT CHANGED: what counts as progress. kept_on_time and kept_late
-- both do, per the semantic decision recorded in 0163 — progress
-- means the work got done, and that is deliberately NOT the same
-- rule as Follow-Through, which is on-time only and measures
-- discipline. Two questions, two numerators. This migration changes
-- the unit being counted, not the definition of a kept unit.
--
-- Column names, order and types are unchanged, so CREATE OR REPLACE
-- is legal and annual_goal_progress / sfa_progress, which average
-- this view's percent, need no change of their own.
-- =============================================================

create or replace view public.priority_progress as
with units as (
  -- The commitment's own row. For a one-off this is the resolution;
  -- for an ongoing commitment it is the week currently outstanding,
  -- which is exactly one open unit.
  select
    c.priority_id,
    c.status
  from public.commitments c
  where c.deleted_at is null
    and c.parked_at is null
    and c.priority_id is not null

  union all

  -- One unit per resolved week. Occurrences only ever exist for
  -- ongoing commitments and only carry resolved statuses — the
  -- CHECK in 0140 admits kept_on_time, kept_late and missed, and
  -- there is no 'open' occurrence to worry about.
  select
    c.priority_id,
    o.status
  from public.commitments c
  join public.commitment_occurrences o
    on o.commitment_id = c.id
  where c.deleted_at is null
    and c.parked_at is null
    and c.priority_id is not null
)
select
  p.id            as priority_id,
  p.company_id,
  p.status,
  p.archived,
  coalesce(
    sum(case when u.status in ('kept_on_time', 'kept_late') then 1 else 0 end),
    0
  )               as kept_count,
  coalesce(sum(case when u.status = 'open'   then 1 else 0 end), 0) as open_count,
  coalesce(sum(case when u.status = 'missed' then 1 else 0 end), 0) as missed_count,
  -- Vestigial since 0011, kept so the row shape is stable. The
  -- ::bigint cast is required: CREATE OR REPLACE VIEW cannot change
  -- a column's type and the original expression was bigint.
  0::bigint       as carried_count,
  count(u.status) as denominator,
  case
    when p.status = 'complete' then 100
    when count(u.status) = 0 then null
    else round(
      100.0
      * sum(
          case when u.status in ('kept_on_time', 'kept_late') then 1 else 0 end
        )::numeric
      / nullif(count(u.status), 0)::numeric
    )::int
  end             as percent
from public.priorities p
-- Join condition rather than a where clause: a priority with no
-- live commitments must still produce a row with percent null,
-- which an inner filter would drop entirely.
left join units u
  on u.priority_id = p.id
group by p.id;

-- security_invoker must be re-asserted: CREATE OR REPLACE VIEW does
-- not preserve it, and without it the view runs as its owner and
-- bypasses RLS — a cross-tenant read, not a cosmetic regression.
-- Same note as 0007 and 0163.
--
-- It also now reaches commitment_occurrences, whose select policy
-- (0140) mirrors the parent commitment's, so an invoker who can see
-- the commitment can see its weeks.
alter view public.priority_progress set (security_invoker = on);
