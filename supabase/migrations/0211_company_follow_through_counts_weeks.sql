-- =============================================================
-- Migration 0211: Follow-Through counts the weeks that happened.
--
-- company_follow_through counted one unit per COMMITMENT ROW. An
-- ongoing commitment is one row that never leaves 'open' while the
-- cycle runs (0140), so a recurring commitment kept faithfully every
-- week for a quarter contributed a single OPEN row and its twelve
-- kept weeks contributed nothing.
--
-- Same gap 0210 closed in priority_progress, and the same rule 0140
-- wrote down when it created the table: "non-ongoing resolved
-- commitments contribute one entry each, ongoing rows contribute one
-- entry per occurrence." Nothing had implemented it — before this
-- migration and its companion change in src/lib/commitments/
-- follow-through-rows.ts, commitment_occurrences was read by nothing
-- outside the resolution path itself.
--
-- WHY BOTH HALVES SHIP TOGETHER. This view feeds /admin/companies;
-- the Session Brief and Portfolio count rows in Node. Fixing one and
-- not the other would put two different Follow-Through numbers for
-- the same company on two pages — which is the exact incident
-- src/lib/commitments/follow-through.ts was written to end, when B&B
-- Electric read 100% on the companies list, 62% on their dashboard
-- and "13 for 13" in the brief on the same day.
--
-- A UNIT IS: every live commitment row, bucketed by its status, plus
-- every occurrence, bucketed by its own. It cannot double-count —
-- resolving an ongoing commitment writes an occurrence and leaves the
-- parent open; resolving a one-off updates the parent and writes no
-- occurrence. A resolution lands in exactly one of the two.
--
-- NOT CHANGED: the rule itself. kept_on_time is the only numerator;
-- kept_late, missed and overdue-open are denominator only. That is
-- the discipline measure, deliberately stricter than the progress
-- measure in priority_progress where a late keep still counts as work
-- done. Two questions, two numerators.
--
-- The overdue-open test applies to commitment rows only. An
-- occurrence is a week already resolved, so it is never open and
-- never overdue; it carries no due_date for the same reason.
--
-- Column names, order and types are unchanged, so CREATE OR REPLACE
-- is legal and every caller keeps its shape.
-- =============================================================

create or replace view public.company_follow_through as
with units as (
  -- The commitment's own row. For a one-off this is its resolution;
  -- for an ongoing commitment it is the week currently outstanding.
  select
    c.company_id,
    c.status,
    c.due_date
  from public.commitments c
  where c.deleted_at is null
    and c.parked_at is null

  union all

  -- One unit per resolved week. Occurrences exist only for ongoing
  -- commitments and carry only resolved statuses (the CHECK in 0140
  -- admits kept_on_time, kept_late and missed), so there is no open
  -- occurrence to age.
  select
    c.company_id,
    o.status,
    null::date as due_date
  from public.commitments c
  join public.commitment_occurrences o
    on o.commitment_id = c.id
  where c.deleted_at is null
    and c.parked_at is null
)
select
  u.company_id,
  count(*) filter (where u.status = 'kept_on_time')::bigint as kept_on_time,
  count(*) filter (where u.status = 'kept_late')::bigint    as kept_late,
  count(*) filter (where u.status = 'missed')::bigint       as missed,
  count(*) filter (
    where u.status = 'open'
      and u.due_date is not null
      and u.due_date < (now() at time zone 'utc')::date
  )::bigint as overdue_open
from units u
group by u.company_id;

-- security_invoker must be re-asserted: CREATE OR REPLACE VIEW does
-- not preserve it, and without it the view runs as its owner and
-- reads across tenants. It now also reaches commitment_occurrences,
-- whose select policy (0140) mirrors the parent commitment's.
alter view public.company_follow_through set (security_invoker = on);

grant select on public.company_follow_through to authenticated;
