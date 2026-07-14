-- =============================================================
-- Phase 3 — Migration 0007: derived progress views (Section 4.5).
--   Percent progress is always computed, never stored.
--   v1 math is intentionally simple; the spec says it will be refined.
--
--   Priority % = kept / (kept + open + missed) across its commitments,
--     excluding 'carried' rows (the carried copy in the later week
--     counts instead). A priority with status='complete' reports 100
--     regardless. A priority with no commitments reports null.
--   Annual Goal % = mean of its non-archived priorities' percents.
--     Priorities with status='complete' count as 100.
--     Priorities with null percent are excluded from the mean.
--     A goal with status='complete' reports 100. No priorities → null.
--   SFA % = mean of its non-archived goals' percents, same handling.
-- =============================================================

-- ---- priority_progress ---------------------------------------
create or replace view public.priority_progress as
select
  p.id            as priority_id,
  p.company_id,
  p.status,
  p.archived,
  -- raw counters (excluding carried per Section 4.5)
  coalesce(sum(case when c.status = 'kept'   then 1 else 0 end), 0) as kept_count,
  coalesce(sum(case when c.status = 'open'   then 1 else 0 end), 0) as open_count,
  coalesce(sum(case when c.status = 'missed' then 1 else 0 end), 0) as missed_count,
  coalesce(sum(case when c.status = 'carried' then 1 else 0 end), 0) as carried_count,
  count(c.id) filter (where c.status <> 'carried') as denominator,
  case
    when p.status = 'complete' then 100
    when count(c.id) filter (where c.status <> 'carried') = 0 then null
    else round(
      100.0
      * sum(case when c.status = 'kept' then 1 else 0 end)::numeric
      / nullif(count(c.id) filter (where c.status <> 'carried'), 0)::numeric
    )::int
  end             as percent
from public.priorities p
left join public.commitments c on c.priority_id = p.id
group by p.id;

-- ---- annual_goal_progress ------------------------------------
create or replace view public.annual_goal_progress as
select
  g.id           as annual_goal_id,
  g.company_id,
  g.status,
  g.archived,
  case
    when g.status = 'complete' then 100
    when count(pp.priority_id) filter (
      where pp.archived = false and pp.percent is not null
    ) = 0 then null
    else round(avg(
      case when pp.archived = false and pp.percent is not null then pp.percent end
    ))::int
  end            as percent
from public.annual_goals g
left join public.priorities p on p.annual_goal_id = g.id and p.archived = false
left join public.priority_progress pp on pp.priority_id = p.id
group by g.id;

-- ---- sfa_progress --------------------------------------------
create or replace view public.sfa_progress as
select
  s.id           as sfa_id,
  s.company_id,
  s.status,
  s.archived,
  case
    when s.status = 'complete' then 100
    when count(gp.annual_goal_id) filter (
      where gp.archived = false and gp.percent is not null
    ) = 0 then null
    else round(avg(
      case when gp.archived = false and gp.percent is not null then gp.percent end
    ))::int
  end            as percent
from public.strategic_focus_areas s
left join public.annual_goals g on g.sfa_id = s.id and g.archived = false
left join public.annual_goal_progress gp on gp.annual_goal_id = g.id
group by s.id;

-- ---- Grants + defensive security_invoker ---------------------
-- Views inherit RLS from their base tables in Postgres 15+ ONLY when
-- security_invoker is set. Without this, views run as the view owner
-- and bypass RLS. Set it explicitly on every view.
alter view public.priority_progress    set (security_invoker = on);
alter view public.annual_goal_progress set (security_invoker = on);
alter view public.sfa_progress         set (security_invoker = on);

grant select on public.priority_progress    to authenticated;
grant select on public.annual_goal_progress to authenticated;
grant select on public.sfa_progress         to authenticated;
