-- =============================================================
-- Migration 0209: a quarterly priority may hang straight off a
-- focus area.
--
-- WHY. The cascade assumed every focus area is multi-year:
-- focus area → goal → quarterly priority. A company in its first
-- quarter often has a focus area whose whole life IS that quarter,
-- and the only way to express it was to invent a goal that repeats
-- the focus area's title back at the reader. This lets the priority
-- sit where it actually belongs, WITHOUT removing goals: a focus
-- area may hold goals, priorities, or both.
--
-- Three things land here:
--   1. priorities.sfa_id, with a parent-exclusive CHECK.
--   2. A same-company trigger over BOTH parents — which closes a
--      pre-existing hole on annual_goal_id, not just the new column.
--   3. sfa_progress averages goals AND direct priorities as peers.
--
-- No RLS change. Every policy on `priorities` keys on company_id
-- and role and has never looked at the parent, so a new parent
-- column grants nothing and hides nothing.
-- =============================================================

-- ---- 1. The column ------------------------------------------
alter table public.priorities
  add column if not exists sfa_id uuid
  references public.strategic_focus_areas(id) on delete set null;

create index if not exists priorities_sfa_id_idx on public.priorities (sfa_id);

-- A priority has ONE parent or none. Both at once is not a richer
-- link, it is two contradictory answers to "where does this roll
-- up?" — and the progress math would count it twice. Mirrors
-- `commitments_link_exclusive`, which caps a commitment's link
-- types at one for the same reason.
alter table public.priorities
  drop constraint if exists priorities_parent_exclusive;
alter table public.priorities
  add constraint priorities_parent_exclusive
  check (annual_goal_id is null or sfa_id is null);

-- ---- 2. The same-company invariant --------------------------
-- This is not new surface. `priorities_update_owner` has always had
-- a WITH CHECK of `owner_id = auth.uid()` and nothing more, so an
-- owner could already re-parent their priority onto ANOTHER
-- company's goal; nothing in the app offers it and no row has ever
-- done it, but the boundary was courtesy rather than structure.
-- Adding a second parent column would have duplicated the hole, so
-- it is closed for both at once.
--
-- SECURITY DEFINER so the lookup sees the parent row regardless of
-- the caller's own RLS grants: a legitimate write must not fail
-- because the checker cannot see what the writer can.
create or replace function public.assert_priority_parent_same_company()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_company uuid;
begin
  if new.annual_goal_id is not null then
    select company_id into parent_company
      from public.annual_goals
     where id = new.annual_goal_id;
    if parent_company is null then
      raise exception 'priority_parent_goal_missing: goal % not found', new.annual_goal_id;
    end if;
    if parent_company <> new.company_id then
      raise exception 'priority_parent_cross_tenant: priority (company %) cannot hang off goal % (company %)',
        new.company_id, new.annual_goal_id, parent_company;
    end if;
  end if;

  if new.sfa_id is not null then
    select company_id into parent_company
      from public.strategic_focus_areas
     where id = new.sfa_id;
    if parent_company is null then
      raise exception 'priority_parent_sfa_missing: focus area % not found', new.sfa_id;
    end if;
    if parent_company <> new.company_id then
      raise exception 'priority_parent_cross_tenant: priority (company %) cannot hang off focus area % (company %)',
        new.company_id, new.sfa_id, parent_company;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.assert_priority_parent_same_company() from public;

drop trigger if exists priorities_parent_same_company on public.priorities;
create trigger priorities_parent_same_company
  before insert or update on public.priorities
  for each row execute function public.assert_priority_parent_same_company();

-- ---- 3. Progress roll-up ------------------------------------
-- A focus area's percent was the mean of its GOALS' percents. A
-- direct priority is a peer of a goal, so it joins that mean as one
-- more child — the product owner's decision, and the one consistent
-- with the level below, where a goal already averages its
-- priorities one-each regardless of how many commitments each holds.
--
-- The visible consequence: a focus area holding one goal (which
-- holds five priorities) and one direct priority weighs them 50/50.
-- That is intended. Depth is not weight anywhere in this cascade.
create or replace view public.sfa_progress as
with child_percent as (
  select
    g.sfa_id            as sfa_id,
    gp.percent          as percent
  from public.annual_goals g
  join public.annual_goal_progress gp on gp.annual_goal_id = g.id
  where g.archived = false
    and g.sfa_id is not null
  union all
  select
    p.sfa_id            as sfa_id,
    pp.percent          as percent
  from public.priorities p
  join public.priority_progress pp on pp.priority_id = p.id
  where p.archived = false
    and p.sfa_id is not null
)
select
  s.id           as sfa_id,
  s.company_id,
  s.status,
  s.archived,
  case
    when s.status = 'complete' then 100
    when count(cp.percent) = 0 then null
    else round(avg(cp.percent))::int
  end            as percent
from public.strategic_focus_areas s
left join child_percent cp
  on cp.sfa_id = s.id
 and cp.percent is not null
group by s.id;

-- security_invoker must be re-asserted: CREATE OR REPLACE VIEW does
-- not preserve it, and without it the view runs as its owner and
-- bypasses RLS. That would be a cross-tenant read, not a cosmetic
-- regression. Same note as migrations 0007 and 0163.
alter view public.sfa_progress set (security_invoker = on);

grant select on public.sfa_progress to authenticated;
