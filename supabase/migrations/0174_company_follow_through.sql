-- =============================================================
-- Migration 0174: Follow-Through Rate, counted in the database.
--
-- getCompaniesOverview built the /admin/companies list by selecting
-- EVERY commitment for EVERY company the caller can see — no date
-- bound, no limit — and reducing them in Node to one percentage per
-- company. For a system_admin that is every live commitment on the
-- instance, pulled over the wire to produce a handful of integers.
--
-- Invisible at today's volume and fatal later, and the failure is
-- worse than slow. If a PostgREST row cap is ever configured, the
-- query silently truncates and every company's rate becomes quietly
-- wrong with nothing raised. An unbounded read on an admin surface is
-- a correctness problem wearing a performance costume.
--
-- WHY AN AGGREGATE AND NOT A DATE BOUND. The obvious cheap fix is to
-- bound the query to a window. It is the wrong fix here, because the
-- rate on this surface is not defined over one:
-- src/lib/commitments/follow-through.ts defines Follow-Through as
-- all-time over four buckets, and the whole reason that file exists is
-- that the same number was computed three different ways on three
-- surfaces and disagreed on the same day (B&B Electric, 2026-09-04:
-- 100% on this list, 62% on their dashboard, "13 for 13" in the
-- brief). Introducing a fourth window here would recreate exactly the
-- drift that file was written to end. So the semantics are held
-- constant and only the place the counting happens moves.
--
-- WHAT THE VIEW COUNTS, mirroring that file bucket for bucket:
--
--   kept_on_time     numerator and denominator
--   kept_late        denominator only
--   missed           denominator only
--   open, past due   denominator only, STRICTLY past due — a
--                    commitment due today is not late today
--   open, not yet due  excluded entirely
--
-- And the population rules the caller used to enforce: soft-deleted
-- and parked rows never count; operational and issue-linked
-- commitments do.
--
-- THE CLOCK IS UTC, DELIBERATELY. This is a cross-tenant list spanning
-- timezones, so there is no single company clock to judge "past due"
-- against; the app used todayInTimezone("UTC") for that reason.
-- `(now() at time zone 'utc')::date` reproduces it exactly and does
-- not depend on the database's own timezone setting, which is one
-- fewer thing to assume (see E1 in docs/failure-modes.md).
--
-- SECURITY_INVOKER IS LOAD-BEARING. Without it a view runs as its
-- owner and bypasses RLS, which on a table keyed by company_id is a
-- cross-tenant read, not a cosmetic regression. With it, the scan
-- underneath is filtered by the caller's own policies before the
-- grouping happens: a company_admin aggregates their own company's
-- commitments and nobody else's, exactly as the in-app version did.
-- Same note as migrations 0007 and 0163, which have been bitten by
-- this being easy to drop on a CREATE OR REPLACE.
-- =============================================================

create or replace view public.company_follow_through as
select
  c.company_id,
  count(*) filter (where c.status = 'kept_on_time')::bigint as kept_on_time,
  count(*) filter (where c.status = 'kept_late')::bigint    as kept_late,
  count(*) filter (where c.status = 'missed')::bigint       as missed,
  count(*) filter (
    where c.status = 'open'
      and c.due_date is not null
      and c.due_date < (now() at time zone 'utc')::date
  )::bigint as overdue_open
from public.commitments c
where c.deleted_at is null
  and c.parked_at is null
group by c.company_id;

alter view public.company_follow_through set (security_invoker = on);

grant select on public.company_follow_through to authenticated;
