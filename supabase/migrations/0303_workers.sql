-- =============================================================
-- Migration 0303: workers, the browser-teaching prototype
--
-- WHY. Jason, 2026-10-27: a worker is given a job in plain words and
-- does it in a real browser, in the cloud, while you watch. A
-- prototype, built on its own branch; Jason chose to land its tables
-- on main so the shared dev clone matches main while it is built
-- (2026-10-27). Nothing in main reads them, and the fleet gets them
-- only on his go. If the prototype is dropped, a later migration drops
-- them.
--
--   workers          one worker: name, instructions, whether it may
--                    press buttons that change things without asking,
--                    and its saved browser logins (Browserbase context)
--   worker_runs      one task given to a worker, and how it went; a
--                    task waiting on its owner keeps the conversation
--                    so far and the open question or approval
--   worker_steps     each thing the worker did on that task, in order
--   worker_rules     "Allow always" answers: press buttons on this site
--                    without asking
--   worker_memories  notes the worker reads on every task
--   worker_skills    a task taught from a finished run: written steps
--                    the worker follows next time
--   worker_secrets   passwords the owner gave it, kept in Vault; the
--                    worker types them without ever reading them
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
-- Nothing is deleted from workers, runs or steps: a worker is
-- archived (archived_at), and steps are written once and never
-- changed. Rules, memories, skills and secrets can be deleted by their
-- owner.
--
-- A SECRET IS NEVER READ BACK BY THE PERSON'S CLIENT. It is saved
-- through worker_secret_save (the owner, as themselves) and read only by
-- worker_secret_value, which only the service role may call: the
-- runner, acting for the owner after it has read the run as them. As
-- connection_secret (0257) is.
--
-- Authorship is stamped by stamp_created_by() (0225) on every table,
-- and the rules below read it.
--
-- Harness probes "workers · own, system admin, primary only" and
-- "workers · secrets never read back".
-- =============================================================

create table if not exists public.workers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  instructions text not null default '' check (length(instructions) <= 32768),
  allow_presses boolean not null default false,
  browser_context_id text check (browser_context_id is null or length(browser_context_id) <= 200),
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
    check (status in ('queued', 'running', 'needs_you', 'done', 'failed', 'stopped', 'expired')),
  browser_session_id text check (browser_session_id is null or length(browser_session_id) <= 200),
  result text check (result is null or length(result) <= 20000),
  error text check (error is null or length(error) <= 2000),
  step_count integer not null default 0 check (step_count >= 0),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cost_usd_cents numeric(12, 4) not null default 0 check (cost_usd_cents >= 0),
  -- While it waits on its owner: the conversation so far (screenshots
  -- taken out), the page it was on, and what it is waiting for.
  conversation jsonb,
  last_url text check (last_url is null or length(last_url) <= 4096),
  pending jsonb,
  asked_at timestamptz,
  skill_id uuid,
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


create table if not exists public.worker_rules (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workers(id) on delete cascade,
  kind text not null check (kind in ('press')),
  domain text not null check (length(btrim(domain)) between 1 and 253),
  decision text not null default 'allow' check (decision in ('allow', 'ask')),
  created_by uuid references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (worker_id, kind, domain)
);

comment on table public.worker_rules is
  'A worker''s "Allow always" answers (0303): press buttons that change things on this site without asking. Payments, deletes, public posts, access changes and terms always ask, whatever is here. Its owner only.';

create table if not exists public.worker_memories (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workers(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 200),
  body text not null check (length(btrim(body)) between 1 and 8000),
  created_by uuid references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.worker_memories is
  'Notes a worker reads on every task (0303). Its owner only.';

create table if not exists public.worker_skills (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workers(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 200),
  body text not null check (length(btrim(body)) between 1 and 16000),
  source_run_id uuid references public.worker_runs(id) on delete set null,
  created_by uuid references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.worker_skills is
  'A task taught from a finished run (0303): the steps written out, followed next time. Its owner only.';

alter table public.worker_runs
  drop constraint if exists worker_runs_skill_id_fkey;
alter table public.worker_runs
  add constraint worker_runs_skill_id_fkey foreign key (skill_id) references public.worker_skills(id) on delete set null;

create table if not exists public.worker_secrets (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workers(id) on delete cascade,
  label text not null check (length(btrim(label)) between 1 and 120),
  secret_id uuid,
  created_by uuid references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (worker_id, label)
);

comment on table public.worker_secrets is
  'Passwords a worker was given (0303): the label here, the value in Vault. Its owner sees the label only.';

create index if not exists worker_rules_worker on public.worker_rules (worker_id);
create index if not exists worker_memories_worker on public.worker_memories (worker_id);
create index if not exists worker_skills_worker on public.worker_skills (worker_id);
create index if not exists worker_secrets_worker on public.worker_secrets (worker_id);

do $$
declare t text;
begin
  foreach t in array array['workers', 'worker_runs', 'worker_steps', 'worker_rules', 'worker_memories', 'worker_skills', 'worker_secrets'] loop
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
grant select, insert, update, delete on public.worker_rules, public.worker_memories, public.worker_skills to authenticated;
-- Secrets: the label is read and a secret removed as the owner; saving
-- one goes through worker_secret_save.
grant select, delete on public.worker_secrets to authenticated;

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

-- ---- Rules, memories, skills, secrets -----------------------------
-- Roles: system_admin, on rows they created, of a worker they own.

do $$
declare t text;
begin
  foreach t in array array['worker_rules', 'worker_memories', 'worker_skills'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated '
      'using ((select public.auth_role()) = ''system_admin'' and created_by = (select auth.uid()))',
      t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated '
      'with check ((select public.auth_role()) = ''system_admin'' and created_by = (select auth.uid()) '
      'and exists (select 1 from public.workers w where w.id = %I.worker_id and w.created_by = (select auth.uid())))',
      t || '_insert', t, t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format(
      'create policy %I on public.%I for update to authenticated '
      'using ((select public.auth_role()) = ''system_admin'' and created_by = (select auth.uid())) '
      'with check ((select public.auth_role()) = ''system_admin'' and created_by = (select auth.uid()) '
      'and exists (select 1 from public.workers w where w.id = %I.worker_id and w.created_by = (select auth.uid())))',
      t || '_update', t, t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated '
      'using ((select public.auth_role()) = ''system_admin'' and created_by = (select auth.uid()))',
      t || '_delete', t);
  end loop;
end $$;

drop policy if exists worker_secrets_select on public.worker_secrets;
create policy worker_secrets_select on public.worker_secrets
  for select to authenticated
  using ((select public.auth_role()) = 'system_admin' and created_by = (select auth.uid()));
drop policy if exists worker_secrets_delete on public.worker_secrets;
create policy worker_secrets_delete on public.worker_secrets
  for delete to authenticated
  using ((select public.auth_role()) = 'system_admin' and created_by = (select auth.uid()));

-- A removed secret takes its Vault entry with it.
create or replace function public.worker_secret_forget()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.secret_id is not null then
    delete from vault.secrets where id = old.secret_id;
  end if;
  return old;
end;
$$;
revoke all on function public.worker_secret_forget() from public, anon, authenticated;

drop trigger if exists worker_secret_forget on public.worker_secrets;
create trigger worker_secret_forget after delete on public.worker_secrets
  for each row execute function public.worker_secret_forget();

-- Save: system_admin, on a worker they own, on the primary instance.
create or replace function public.worker_secret_save(p_worker_id uuid, p_label text, p_value text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.worker_secrets;
  v_secret_id uuid;
begin
  if (select auth.uid()) is null
     or (select public.auth_role()) is distinct from 'system_admin'
     or not (select public.is_primary_instance())
     or not exists (select 1 from public.workers w
                     where w.id = p_worker_id and w.created_by = (select auth.uid()) and w.archived_at is null) then
    raise exception 'only the worker''s owner can give it a password' using errcode = '42501';
  end if;
  if p_value is null or length(p_value) = 0 or length(p_value) > 4000 then
    raise exception 'a password is 1 to 4000 characters' using errcode = '22023';
  end if;
  if p_label is null or length(btrim(p_label)) not between 1 and 120 then
    raise exception 'a password needs a name of 1 to 120 characters' using errcode = '22023';
  end if;

  select * into v_row from public.worker_secrets
   where worker_id = p_worker_id and label = btrim(p_label)
   for update;
  if v_row.id is null then
    insert into public.worker_secrets (worker_id, label, created_by)
    values (p_worker_id, btrim(p_label), (select auth.uid()))
    returning * into v_row;
  end if;
  if v_row.secret_id is null then
    v_secret_id := vault.create_secret(p_value, 'worker_secret:' || v_row.id::text, 'a worker''s saved password');
  else
    perform vault.update_secret(v_row.secret_id, p_value);
    v_secret_id := v_row.secret_id;
  end if;
  update public.worker_secrets set secret_id = v_secret_id, updated_at = now() where id = v_row.id;
  return v_row.id;
end;
$$;
revoke all on function public.worker_secret_save(uuid, text, text) from public, anon;
grant execute on function public.worker_secret_save(uuid, text, text) to authenticated;

-- Read: service_role only. The runner, typing it for the worker's owner.
create or replace function public.worker_secret_value(p_worker_id uuid, p_label text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select ds.decrypted_secret
    from public.worker_secrets s
    join vault.decrypted_secrets ds on ds.id = s.secret_id
   where s.worker_id = p_worker_id
     and s.label = btrim(p_label)
$$;
revoke all on function public.worker_secret_value(uuid, text) from public, anon, authenticated;
grant execute on function public.worker_secret_value(uuid, text) to service_role;

-- ---- The primary instance only ------------------------------------
-- As 0295 does for the Capacity Diagnostic: restrictive, ANDed with
-- the rules above, so they decide who and this decides where.

do $$
declare t text;
begin
  foreach t in array array['workers', 'worker_runs', 'worker_steps', 'worker_rules', 'worker_memories', 'worker_skills', 'worker_secrets'] loop
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
    'worker_teach',
    'other'
  ));
