-- =============================================================
-- Migration 0303: workers, the browser-teaching prototype
--
-- WHY. Jason, 2026-10-27: a worker is given a job in plain words and
-- does it in a real browser, in the cloud, while you watch. This is
-- the first of three prototype steps (create a worker, give it a task,
-- watch it work); questions, approvals and teaching follow.
--
--   workers       one worker: its name and instructions
--   worker_runs   one task given to a worker, and how it went
--   worker_steps  each thing the worker did on that task, in order
--
-- ACCESS. A system admin, on their own workers only, on the primary
-- instance only. Nobody else reads or writes any of it: another system
-- admin does not see your workers, and company admins, guides,
-- portfolio admins and team members see nothing. The run is carried out
-- as the person who started it, inside their request, so every write
-- here is theirs and nothing is written by the service role. Outside
-- assistants are refused by the event trigger every new table is born
-- under (assistant_refuse_new_tables, 0270). Nothing is granted to anon.
--
-- Nothing is deleted: a worker is archived (archived_at). Steps are
-- written once and never changed.
--
-- Authorship is stamped by stamp_created_by() (0225) on every table,
-- and the rules below read it.
--
-- Harness probe "workers · own, system admin, primary only".
-- =============================================================

create table if not exists public.workers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  instructions text not null default '' check (length(instructions) <= 32768),
  archived_at timestamptz,
  created_by uuid references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.workers is
  'A worker (0303): a job described in plain words, done in a cloud browser. Its owner (a system admin) only, on the primary instance.';

create index if not exists workers_owner on public.workers (created_by, created_at desc);

create table if not exists public.worker_runs (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workers(id) on delete cascade,
  task text not null check (length(btrim(task)) between 1 and 4000),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'done', 'failed', 'stopped')),
  browser_session_id text check (browser_session_id is null or length(browser_session_id) <= 200),
  result text check (result is null or length(result) <= 20000),
  error text check (error is null or length(error) <= 2000),
  step_count integer not null default 0 check (step_count >= 0),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cost_usd_cents numeric(12, 4) not null default 0 check (cost_usd_cents >= 0),
  started_at timestamptz,
  finished_at timestamptz,
  created_by uuid references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.worker_runs is
  'One task given to a worker (0303), its status, result and cost. Its owner only.';

create index if not exists worker_runs_worker on public.worker_runs (worker_id, created_at desc);

create table if not exists public.worker_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.worker_runs(id) on delete cascade,
  seq integer not null check (seq >= 1),
  kind text not null check (kind in ('note', 'action')),
  tool text check (tool is null or length(tool) <= 60),
  summary text not null check (length(summary) <= 2000),
  is_error boolean not null default false,
  created_by uuid references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (run_id, seq)
);

comment on table public.worker_steps is
  'Each thing a worker did on a task (0303), in order: what it said and what it did in the browser. Its owner only. Written once.';

do $$
declare t text;
begin
  foreach t in array array['workers', 'worker_runs', 'worker_steps'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('drop trigger if exists stamp_created_by on public.%I', t);
    execute format(
      'create trigger stamp_created_by before insert on public.%I for each row execute function public.stamp_created_by()',
      t
    );
  end loop;
end $$;

grant select, insert, update on public.workers, public.worker_runs to authenticated;
grant select, insert on public.worker_steps to authenticated;

-- ---- Workers ------------------------------------------------------
-- Roles: system_admin, on rows they created.

drop policy if exists workers_select on public.workers;
create policy workers_select on public.workers
  for select to authenticated
  using ((select public.auth_role()) = 'system_admin' and created_by = (select auth.uid()));
drop policy if exists workers_insert on public.workers;
create policy workers_insert on public.workers
  for insert to authenticated
  with check ((select public.auth_role()) = 'system_admin' and created_by = (select auth.uid()));
drop policy if exists workers_update on public.workers;
create policy workers_update on public.workers
  for update to authenticated
  using ((select public.auth_role()) = 'system_admin' and created_by = (select auth.uid()))
  with check ((select public.auth_role()) = 'system_admin' and created_by = (select auth.uid()));

-- ---- Runs ---------------------------------------------------------
-- Roles: system_admin, on runs they started, of a worker they own.

drop policy if exists worker_runs_select on public.worker_runs;
create policy worker_runs_select on public.worker_runs
  for select to authenticated
  using ((select public.auth_role()) = 'system_admin' and created_by = (select auth.uid()));
drop policy if exists worker_runs_insert on public.worker_runs;
create policy worker_runs_insert on public.worker_runs
  for insert to authenticated
  with check (
    (select public.auth_role()) = 'system_admin'
    and created_by = (select auth.uid())
    and exists (select 1 from public.workers w
                where w.id = worker_runs.worker_id
                  and w.created_by = (select auth.uid())
                  and w.archived_at is null)
  );
drop policy if exists worker_runs_update on public.worker_runs;
create policy worker_runs_update on public.worker_runs
  for update to authenticated
  using ((select public.auth_role()) = 'system_admin' and created_by = (select auth.uid()))
  with check ((select public.auth_role()) = 'system_admin' and created_by = (select auth.uid()));

-- ---- Steps --------------------------------------------------------
-- Roles: system_admin, on steps of runs they started. Insert only.

drop policy if exists worker_steps_select on public.worker_steps;
create policy worker_steps_select on public.worker_steps
  for select to authenticated
  using ((select public.auth_role()) = 'system_admin' and created_by = (select auth.uid()));
drop policy if exists worker_steps_insert on public.worker_steps;
create policy worker_steps_insert on public.worker_steps
  for insert to authenticated
  with check (
    (select public.auth_role()) = 'system_admin'
    and created_by = (select auth.uid())
    and exists (select 1 from public.worker_runs r
                where r.id = worker_steps.run_id and r.created_by = (select auth.uid()))
  );

-- ---- The primary instance only ------------------------------------
-- As 0295 does for the Capacity Diagnostic: restrictive, ANDed with
-- the rules above, so they decide who and this decides where.

do $$
declare t text;
begin
  foreach t in array array['workers', 'worker_runs', 'worker_steps'] loop
    execute format('drop policy if exists %I on public.%I', t || '_primary_only', t);
    -- Roles: none added. Narrows every role's rules to the primary instance.
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated '
      'using ((select public.is_primary_instance())) '
      'with check ((select public.is_primary_instance()))',
      t || '_primary_only', t
    );
  end loop;
end $$;

-- ---- Cost log -----------------------------------------------------
-- Each model call a worker makes logs under its own purpose.

alter table public.coach_token_usage
  drop constraint if exists coach_token_usage_purpose_check;

alter table public.coach_token_usage
  add constraint coach_token_usage_purpose_check
  check (purpose in (
    'turn',
    'title',
    'themes',
    'analyzer',
    'rd',
    'strengths',
    'brief',
    'clarity',
    'facilitation',
    'facilitation_retry',
    'insights_analysis',
    'memory',
    'speakers',
    'coverage',
    'questions',
    'invitation',
    'principles_check',
    'session_brief',
    'headlines',
    'diagnostic_titles',
    'diagnostic_quotes',
    'diagnostic_readout',
    'diagnostic_pledge',
    'diagnostic_conversation',
    'worker_step',
    'other'
  ));
