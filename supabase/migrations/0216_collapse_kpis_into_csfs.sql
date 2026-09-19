-- =============================================================
-- Migration 0216: one level, not two
--
-- 0166 split measures into a lagging Critical Success Factor and the
-- leading KPIs that drive it. We do not work with clients at both
-- levels, and the data says so: across every non-test company, three
-- measures have ever been logged. The spreadsheet clients actually
-- keep has one column called "Critical Success Factor" and it holds
-- measurable weekly items.
--
-- After this there is one kind. A KPI keeps its id, so its target,
-- its entries, its target history and any external-measures mapping
-- stay attached with nothing to move.
--
-- ---- WHY `kind` COULD NOT BE TRUSTED TO MEAN ANYTHING ---------
--
-- Measured on the fleet before writing this. Howard Concrete Pumping
-- has 24 rows, all kind='csf', and they read: "Weekly - # of jobs
-- completed", "Linear feet of borehole per shift", "Win Percentage"
-- with a target of 30%. Geo-Sci has 16, all kind='csf', and they
-- read: "Zero Lost Time", "Increasing Factored Pipeline".
--
-- Same column, opposite meanings. Which level a company works at is a
-- habit, not a field. So "archive everything with kind='csf'" would
-- have emptied Howard's seven functions completely and taken AiMS
-- Manufacturing's only measure, which is the one the external
-- measures cron is pointed at.
--
-- ---- THE ARCHIVE RULE -----------------------------------------
--
-- A statement is archived only where a measure underneath REPLACES
-- it, and never where it carries anything of its own. Four clauses,
-- each of which spares a real row on the fleet today:
--
--   no target          Howard's "Win Percentage, 30%" survives
--   no entries         nothing with a logged week disappears
--   no external_source the Benson sheet keeps its target
--   has a live KPI     Howard has none, so nothing of Howard's goes
--
-- Nothing is deleted. `archived` already means "off the page, still
-- on file", and a company that wants one back can have it.
--
-- ---- SORT ORDER HAS TO BE REBUILT -----------------------------
--
-- The two kinds numbered independently, so a CSF at 0 and a KPI at 0
-- are the same position in one list. There are 25 such collisions on
-- the clone right now, and left alone the flat page would interleave
-- rows arbitrarily.
--
-- Renumbered so each surviving statement is followed by the measures
-- that were under it, which is the grouping people already see on
-- screen. A company opening the page after this reads its own list in
-- the order it left it, minus the rows that were saying the same
-- thing twice.
--
-- ---- ORDER OF OPERATIONS --------------------------------------
--
-- Archive and renumber FIRST: both read `kind` and `csf_kpi_links`,
-- and neither exists by the end of this file.
--
-- Both are UPDATEs on success_measures, which now carries the target
-- history trigger from 0215. Neither touches target, value_type or
-- target_direction, so the trigger returns early and no history row
-- is written. That is deliberate and worth stating: archiving a
-- measure is not a target change, and a migration that quietly
-- stamped 130 history rows with today's date would have made the
-- first day of history a lie.
-- =============================================================

-- ---- 1. Archive the statements a measure replaces -------------
update public.success_measures m
   set archived = true,
       updated_at = now()
 where m.kind = 'csf'
   and m.archived = false
   and btrim(coalesce(m.target, '')) = ''
   and m.external_source is null
   and not exists (
     select 1 from public.success_measure_entries e
      where e.measure_id = m.id)
   and exists (
     select 1
       from public.csf_kpi_links l
       join public.success_measures k on k.id = l.kpi_id
      where l.csf_id = m.id
        and k.archived = false);

-- ---- 2. One ordering per function ------------------------------
--
-- key 1  the group: a statement's own position, or for a measure the
--        position of the statement it hung under. Keeps a measure
--        beside the thing it was measuring.
-- key 2  the statement first within its group, where it survived.
-- key 3  the measure's own order within the group.
-- key 4  id, so the result is the same on every instance rather than
--        depending on what the planner felt like.
--
-- A KPI linked to more than one CSF takes the earliest, via min().
-- There are none on the fleet, and the link table is many-to-many by
-- design, so this resolves rather than raises.
with parent as (
  select l.kpi_id, min(c.sort_order) as csf_sort
    from public.csf_kpi_links l
    join public.success_measures c on c.id = l.csf_id
   group by l.kpi_id
),
ranked as (
  select m.id,
         (row_number() over (
            partition by m.function_id
            order by coalesce(p.csf_sort, m.sort_order),
                     case when m.kind = 'csf' then 0 else 1 end,
                     m.sort_order,
                     m.id
          ))::int - 1 as new_sort
    from public.success_measures m
    left join parent p on p.kpi_id = m.id
   where m.archived = false
     and m.function_id is not null
)
update public.success_measures m
   set sort_order = r.new_sort
  from ranked r
 where r.id = m.id
   and m.sort_order is distinct from r.new_sort;

-- ---- 3. The link table retires ---------------------------------
--
-- Its whole job was joining the two levels. With one level there is
-- nothing to join, and leaving it would leave a table whose rows
-- describe a structure the app no longer has.
drop table if exists public.csf_kpi_links;

-- ---- 4. `kind` retires -----------------------------------------
--
-- The index goes with it. Its replacement is the read the flat page
-- actually makes: a function's live measures, in order.
drop index if exists public.success_measures_function_kind_idx;

alter table public.success_measures
  drop column if exists kind;

create index if not exists success_measures_function_sort_idx
  on public.success_measures (function_id, sort_order)
  where archived = false;

comment on table public.success_measures is
  'One level. A Critical Success Factor a function is accountable for, with a target, a weekly value and its own target history. The kind column and csf_kpi_links were dropped in 0216: we do not work with clients at two levels, and kind had stopped meaning anything — one company''s CSFs were measurable weekly items and another''s were aspirational statements.';
