-- =============================================================
-- Migration 0019: Functional Chart (absorbs Scorecard)
--
-- The Chart is the "running the business" surface. Plan is where
-- you decide what changes; Chart is where you name the capabilities
-- (Functions) the business needs to deliver value, the outcomes
-- each function is obsessed with, and the success measures that
-- prove it. In old-school terms this is EOS's Accountability Chart
-- with AiMS's LTD language layered on top.
--
-- Shape:
--   functions            — self-referencing tree; leader_id optional
--   function_outcomes    — 1..N per function (soft ceiling at 3)
--   success_measures     — 1..N per outcome, with target + value type
--   success_measure_entries — weekly value log (mirrors scorecard_entries)
--
-- Migration behaviour: the pre-existing scorecard tables
-- (functional_areas / scorecard_metrics / scorecard_entries) stay
-- in place for now — this migration BACKFILLS their content into
-- the new tables so no data is lost. A synthetic "General" outcome
-- gets created per migrated function to hold the migrated metrics.
-- A follow-up migration can drop the old tables once the app has
-- switched to the new surfaces.
--
-- RLS: mirrors scorecard — company members read, admins write,
-- entries can also be written by the parent function's leader.
-- =============================================================

-- ---- functions ------------------------------------------------
create table if not exists public.functions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  parent_function_id uuid references public.functions(id) on delete cascade,
  title text not null,
  description text,
  leader_id uuid references public.profiles(id) on delete set null,
  sort_order int not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists functions_company_id_idx
  on public.functions (company_id);
create index if not exists functions_parent_idx
  on public.functions (parent_function_id);
create index if not exists functions_leader_idx
  on public.functions (leader_id);

drop trigger if exists functions_set_updated_at on public.functions;
create trigger functions_set_updated_at
before update on public.functions
for each row execute function public.set_updated_at();

-- ---- function_outcomes ---------------------------------------
create table if not exists public.function_outcomes (
  id uuid primary key default gen_random_uuid(),
  function_id uuid not null references public.functions(id) on delete cascade,
  title text not null,
  description text,
  sort_order int not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists function_outcomes_function_idx
  on public.function_outcomes (function_id);

drop trigger if exists function_outcomes_set_updated_at on public.function_outcomes;
create trigger function_outcomes_set_updated_at
before update on public.function_outcomes
for each row execute function public.set_updated_at();

-- ---- success_measures ----------------------------------------
create table if not exists public.success_measures (
  id uuid primary key default gen_random_uuid(),
  outcome_id uuid not null references public.function_outcomes(id) on delete cascade,
  description text not null,
  target text,
  value_type text not null default 'number'
    check (value_type in ('number','percent','text')),
  sort_order int not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists success_measures_outcome_idx
  on public.success_measures (outcome_id);

drop trigger if exists success_measures_set_updated_at on public.success_measures;
create trigger success_measures_set_updated_at
before update on public.success_measures
for each row execute function public.set_updated_at();

-- ---- success_measure_entries ---------------------------------
create table if not exists public.success_measure_entries (
  id uuid primary key default gen_random_uuid(),
  measure_id uuid not null references public.success_measures(id) on delete cascade,
  week_ending date not null,
  value_number numeric,
  value_text text,
  entered_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (measure_id, week_ending)
);

create index if not exists success_measure_entries_measure_week_idx
  on public.success_measure_entries (measure_id, week_ending);

drop trigger if exists success_measure_entries_set_updated_at on public.success_measure_entries;
create trigger success_measure_entries_set_updated_at
before update on public.success_measure_entries
for each row execute function public.set_updated_at();

-- =============================================================
-- RLS
-- =============================================================
alter table public.functions enable row level security;
alter table public.function_outcomes enable row level security;
alter table public.success_measures enable row level security;
alter table public.success_measure_entries enable row level security;

alter table public.functions force row level security;
alter table public.function_outcomes force row level security;
alter table public.success_measures force row level security;
alter table public.success_measure_entries force row level security;

-- ---- functions policies -------------------------------------
drop policy if exists functions_select on public.functions;
create policy functions_select on public.functions
for select to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.company_id is not null and ap.company_id = public.functions.company_id)
  )
);

drop policy if exists functions_insert on public.functions;
create policy functions_insert on public.functions
for insert to authenticated
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.functions.company_id)
  )
);

drop policy if exists functions_update on public.functions;
create policy functions_update on public.functions
for update to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.functions.company_id)
  )
)
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.functions.company_id)
  )
);

drop policy if exists functions_delete on public.functions;
create policy functions_delete on public.functions
for delete to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.functions.company_id)
  )
);

-- ---- function_outcomes policies (gated through parent function) ----
drop policy if exists function_outcomes_select on public.function_outcomes;
create policy function_outcomes_select on public.function_outcomes
for select to authenticated
using (
  exists (
    select 1 from public.functions f
    join public.auth_profile() ap on true
    where f.id = public.function_outcomes.function_id
      and (ap.role = 'system_admin'
           or (ap.company_id is not null and ap.company_id = f.company_id))
  )
);

drop policy if exists function_outcomes_write on public.function_outcomes;
create policy function_outcomes_write on public.function_outcomes
for all to authenticated
using (
  exists (
    select 1 from public.functions f
    join public.auth_profile() ap on true
    where f.id = public.function_outcomes.function_id
      and (ap.role = 'system_admin'
           or (ap.role = 'company_admin' and ap.company_id = f.company_id))
  )
)
with check (
  exists (
    select 1 from public.functions f
    join public.auth_profile() ap on true
    where f.id = public.function_outcomes.function_id
      and (ap.role = 'system_admin'
           or (ap.role = 'company_admin' and ap.company_id = f.company_id))
  )
);

-- ---- success_measures policies (gated through outcome → function) --
drop policy if exists success_measures_select on public.success_measures;
create policy success_measures_select on public.success_measures
for select to authenticated
using (
  exists (
    select 1
    from public.function_outcomes o
    join public.functions f on f.id = o.function_id
    join public.auth_profile() ap on true
    where o.id = public.success_measures.outcome_id
      and (ap.role = 'system_admin'
           or (ap.company_id is not null and ap.company_id = f.company_id))
  )
);

drop policy if exists success_measures_write on public.success_measures;
create policy success_measures_write on public.success_measures
for all to authenticated
using (
  exists (
    select 1
    from public.function_outcomes o
    join public.functions f on f.id = o.function_id
    join public.auth_profile() ap on true
    where o.id = public.success_measures.outcome_id
      and (ap.role = 'system_admin'
           or (ap.role = 'company_admin' and ap.company_id = f.company_id))
  )
)
with check (
  exists (
    select 1
    from public.function_outcomes o
    join public.functions f on f.id = o.function_id
    join public.auth_profile() ap on true
    where o.id = public.success_measures.outcome_id
      and (ap.role = 'system_admin'
           or (ap.role = 'company_admin' and ap.company_id = f.company_id))
  )
);

-- ---- success_measure_entries policies ----
-- Read: any company member.
-- Write: admin OR the parent function's leader.
drop policy if exists success_measure_entries_select on public.success_measure_entries;
create policy success_measure_entries_select on public.success_measure_entries
for select to authenticated
using (
  exists (
    select 1
    from public.success_measures m
    join public.function_outcomes o on o.id = m.outcome_id
    join public.functions f on f.id = o.function_id
    join public.auth_profile() ap on true
    where m.id = public.success_measure_entries.measure_id
      and (ap.role = 'system_admin'
           or (ap.company_id is not null and ap.company_id = f.company_id))
  )
);

drop policy if exists success_measure_entries_write on public.success_measure_entries;
create policy success_measure_entries_write on public.success_measure_entries
for all to authenticated
using (
  exists (
    select 1
    from public.success_measures m
    join public.function_outcomes o on o.id = m.outcome_id
    join public.functions f on f.id = o.function_id
    join public.auth_profile() ap on true
    where m.id = public.success_measure_entries.measure_id
      and (ap.role = 'system_admin'
           or (ap.role = 'company_admin' and ap.company_id = f.company_id)
           or f.leader_id = ap.uid)
  )
)
with check (
  exists (
    select 1
    from public.success_measures m
    join public.function_outcomes o on o.id = m.outcome_id
    join public.functions f on f.id = o.function_id
    join public.auth_profile() ap on true
    where m.id = public.success_measure_entries.measure_id
      and (ap.role = 'system_admin'
           or (ap.role = 'company_admin' and ap.company_id = f.company_id)
           or f.leader_id = ap.uid)
  )
);

-- =============================================================
-- Backfill from scorecard tables
--
-- Every functional_area → a top-level function.
-- Every scorecard_metric → a success_measure under a synthetic
--   "General" outcome we create per migrated function.
-- Every scorecard_entry → a success_measure_entry keyed to the
--   migrated measure by name+company.
--
-- Idempotency: we only migrate rows whose target doesn't already
-- exist (matched by company_id + title/description), so re-running
-- the migration is safe.
-- =============================================================

-- functional_areas → functions (top-level, no parent)
insert into public.functions (
  company_id, parent_function_id, title, description, leader_id, sort_order, created_at
)
select
  fa.company_id,
  null,
  fa.name,
  null,
  fa.accountable_id,
  fa.sort_order,
  fa.created_at
from public.functional_areas fa
where not exists (
  select 1 from public.functions f
  where f.company_id = fa.company_id
    and f.title = fa.name
    and f.parent_function_id is null
);

-- One "General" outcome per migrated function (used to hold the
-- migrated metrics). Only create when the function has metrics
-- coming and no outcome yet.
insert into public.function_outcomes (function_id, title, description, sort_order)
select f.id, 'General', 'Migrated from the legacy scorecard. Reorganize as outcomes become clearer.', 0
from public.functions f
join public.functional_areas fa
  on fa.company_id = f.company_id
 and fa.name = f.title
 and f.parent_function_id is null
where exists (select 1 from public.scorecard_metrics sm where sm.functional_area_id = fa.id)
  and not exists (
    select 1 from public.function_outcomes o
    where o.function_id = f.id
  );

-- scorecard_metrics → success_measures (under the "General" outcome
-- for the migrated function of that metric's area).
insert into public.success_measures (
  outcome_id, description, target, value_type, sort_order, archived, created_at
)
select
  o.id,
  sm.name,
  sm.target,
  sm.value_type,
  sm.sort_order,
  sm.archived,
  sm.created_at
from public.scorecard_metrics sm
join public.functional_areas fa on fa.id = sm.functional_area_id
join public.functions f
  on f.company_id = fa.company_id
 and f.title = fa.name
 and f.parent_function_id is null
join public.function_outcomes o
  on o.function_id = f.id
 and o.title = 'General'
where not exists (
  select 1 from public.success_measures m2
  where m2.outcome_id = o.id
    and m2.description = sm.name
);

-- scorecard_entries → success_measure_entries.
insert into public.success_measure_entries (
  measure_id, week_ending, value_number, value_text, entered_by, created_at
)
select
  m.id,
  se.week_ending,
  se.value_number,
  se.value_text,
  se.entered_by,
  se.created_at
from public.scorecard_entries se
join public.scorecard_metrics sm on sm.id = se.metric_id
join public.functional_areas fa on fa.id = sm.functional_area_id
join public.functions f
  on f.company_id = fa.company_id
 and f.title = fa.name
 and f.parent_function_id is null
join public.function_outcomes o
  on o.function_id = f.id
 and o.title = 'General'
join public.success_measures m
  on m.outcome_id = o.id
 and m.description = sm.name
where not exists (
  select 1 from public.success_measure_entries e2
  where e2.measure_id = m.id
    and e2.week_ending = se.week_ending
);
