-- =============================================================
-- Migration 0294: the Capacity Diagnostic module
--
-- WHY. Jason, 2026-10-22 (Capacity Diagnostic Module: AiMS HQ Build
-- Spec, phase 1). The person running a Capacity Diagnostic conducts the
-- three-week engagement inside AiMS HQ: the clients it is run for, the
-- people in scope, their tasks and answers, the conversations, and the
-- first win and its measured week.
--
-- SELF-CONTAINED, on purpose. No company_id, no profile ids for the
-- people in scope, nothing that joins to a tenant. A client is a
-- diagnostic_clients row and a participant is a diagnostic_participants
-- row; neither is a company or a user. A client that later becomes a
-- platform company is a separate act with nothing to migrate (Jason,
-- 2026-10-22: "the boundary with companies is absolute").
--
-- ACCESS. Every table is system admin only, read and write, the same
-- shape as lead_meeting_analyses (0265). A company admin, a guide, a
-- portfolio admin and a team member read and write nothing here.
-- Outside assistants are refused by the event trigger every new table
-- is born under (assistant_refuse_new_tables, 0270). Nothing is granted
-- to anon. Nothing is written by the service role.
--
-- Nothing is deleted from clients or diagnostics: they are archived
-- (archived_at). A task and an unapproved quote can be removed, since
-- the lead corrects the survey grid and discards proposed lines.
--
-- PUBLISHED IS FROZEN. Once a diagnostic has published_at, its notes and
-- quotes take no insert, update or delete: the readout renders from what
-- was published. Phase 1 has no Publish button; the rule is here so the
-- tables are born with it.
--
-- Authorship is stamped by stamp_created_by() (0225) on every table.
--
-- Harness probe "diagnostics · system admin only".
-- =============================================================

-- ---- Clients -----------------------------------------------------

create table if not exists public.diagnostic_clients (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 200),
  owner_name text check (owner_name is null or length(owner_name) <= 200),
  owner_email text check (owner_email is null or position('@' in owner_email) > 1),
  industry text check (industry is null or length(industry) <= 200),
  employee_count integer check (employee_count is null or employee_count between 1 and 100000),
  city text check (city is null or length(city) <= 200),
  country text check (country is null or country in ('CA', 'US')),
  source text check (source is null or source in ('referral', 'peer_group', 'association', 'lift', 'other')),
  notes text check (notes is null or length(notes) <= 8000),
  archived_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.diagnostic_clients is
  'Capacity Diagnostic clients (0294). One client business. No link to companies, by design. System admins only.';

-- ---- Diagnostics (one engagement for one client) -----------------

create table if not exists public.diagnostics (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.diagnostic_clients(id) on delete restrict,
  status text not null default 'preflight'
    check (status in ('preflight', 'kickoff', 'survey', 'conversations', 'build', 'readout', 'decided')),
  -- Pre-flight.
  tools_in_use text check (tools_in_use is null or length(tools_in_use) <= 4000),
  it_contact text check (it_contact is null or length(it_contact) <= 500),
  access_secured boolean not null default false,
  brief_sent boolean not null default false,
  conversations_booked boolean not null default false,
  -- Kickoff.
  scope text check (scope is null or length(scope) <= 2000),
  capacity_destination text check (capacity_destination is null or length(capacity_destination) <= 2000),
  pledge_text text check (pledge_text is null or length(pledge_text) <= 4000),
  pledge_sent_at timestamptz,
  kickoff_at date,
  -- Build.
  midpoint_at date,
  midpoint_note text check (midpoint_note is null or length(midpoint_note) <= 4000),
  -- Readout (phase 2 writes these).
  readout_at date,
  published_at timestamptz,
  guarantee_hours numeric(5, 1) not null default 3 check (guarantee_hours > 0),
  decision text not null default 'pending' check (decision in ('pending', 'sprint', 'declined')),
  archived_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.diagnostics is
  'One Capacity Diagnostic engagement for one client (0294). Price is deliberately not stored. System admins only.';

create index if not exists diagnostics_client on public.diagnostics (client_id, created_at desc);

-- ---- Participants (one person in scope) --------------------------

create table if not exists public.diagnostic_participants (
  id uuid primary key default gen_random_uuid(),
  diagnostic_id uuid not null references public.diagnostics(id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 200),
  role_title text check (role_title is null or length(role_title) <= 200),
  email text check (email is null or position('@' in email) > 1),
  years_with_company numeric(4, 1) check (years_with_company is null or years_with_company between 0 and 80),
  survey_entered_at timestamptz,
  in_conversations boolean not null default false,
  conversation_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  -- Lets a child row name its participant and diagnostic together, so
  -- the two cannot disagree.
  unique (id, diagnostic_id)
);

create index if not exists diagnostic_participants_diagnostic on public.diagnostic_participants (diagnostic_id);

-- ---- Tasks (one recurring task one person does) ------------------

create table if not exists public.diagnostic_tasks (
  id uuid primary key default gen_random_uuid(),
  diagnostic_id uuid not null,
  participant_id uuid not null,
  title text not null check (length(btrim(title)) between 1 and 300),
  hours_per_week numeric(5, 1) not null check (hours_per_week >= 0 and hours_per_week <= 80),
  energy smallint not null check (energy between 1 and 5),
  judgment smallint not null check (judgment between 1 and 5),
  source text not null default 'survey' check (source in ('survey', 'conversation', 'lead')),
  volume_units_per_week numeric(8, 1) check (volume_units_per_week is null or volume_units_per_week >= 0),
  minutes_per_unit numeric(6, 1) check (minutes_per_unit is null or minutes_per_unit >= 0),
  data_risk text check (data_risk is null or data_risk in ('low', 'medium', 'high')),
  build_effort_hours numeric(5, 1) check (build_effort_hours is null or build_effort_hours >= 0),
  candidate_override boolean,
  canonical_title text check (canonical_title is null or length(canonical_title) <= 300),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (participant_id, diagnostic_id)
    references public.diagnostic_participants (id, diagnostic_id) on delete restrict,
  unique (id, diagnostic_id)
);

create index if not exists diagnostic_tasks_diagnostic on public.diagnostic_tasks (diagnostic_id);

-- ---- Answers (one participant's three open answers) --------------

create table if not exists public.diagnostic_answers (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null unique references public.diagnostic_participants(id) on delete restrict,
  best_work text check (best_work is null or length(best_work) <= 4000),
  task_to_lose text check (task_to_lose is null or length(task_to_lose) <= 4000),
  trust_needs text check (trust_needs is null or length(trust_needs) <= 4000),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---- Notes (the lead's notes from one conversation) --------------

create table if not exists public.diagnostic_notes (
  id uuid primary key default gen_random_uuid(),
  diagnostic_id uuid not null,
  participant_id uuid not null unique,
  body text not null default '' check (length(body) <= 8000),
  peak_experience text check (peak_experience is null or length(peak_experience) <= 2000),
  redeploy_wish text check (redeploy_wish is null or length(redeploy_wish) <= 2000),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (participant_id, diagnostic_id)
    references public.diagnostic_participants (id, diagnostic_id) on delete restrict
);

-- ---- Quotes (one line the readout may use) -----------------------

create table if not exists public.diagnostic_quotes (
  id uuid primary key default gen_random_uuid(),
  diagnostic_id uuid not null references public.diagnostics(id) on delete restrict,
  -- Null when the line is to appear without a name. The default.
  participant_id uuid,
  text text not null check (length(btrim(text)) between 1 and 1000),
  approved_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (participant_id, diagnostic_id)
    references public.diagnostic_participants (id, diagnostic_id) on delete restrict
);

create index if not exists diagnostic_quotes_diagnostic on public.diagnostic_quotes (diagnostic_id);

-- ---- Wins (one build and its measurement) ------------------------

create table if not exists public.diagnostic_wins (
  id uuid primary key default gen_random_uuid(),
  diagnostic_id uuid not null,
  task_id uuid not null,
  -- A slug from src/lib/diagnostics/win-patterns.ts.
  pattern text not null check (pattern ~ '^[a-z_]{1,60}$'),
  title text not null check (length(btrim(title)) between 1 and 300),
  built_at date,
  in_use_from date,
  baseline_minutes_per_unit numeric(6, 1) check (baseline_minutes_per_unit is null or baseline_minutes_per_unit >= 0),
  after_minutes_per_unit numeric(6, 1) check (after_minutes_per_unit is null or after_minutes_per_unit >= 0),
  units_per_week numeric(8, 1) check (units_per_week is null or units_per_week >= 0),
  -- A Friday, like every weekly record.
  measured_week_ending date check (measured_week_ending is null or extract(isodow from measured_week_ending) = 5),
  is_first_win boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (task_id, diagnostic_id)
    references public.diagnostic_tasks (id, diagnostic_id) on delete restrict
);

-- Exactly one first win per diagnostic.
create unique index if not exists diagnostic_wins_one_first
  on public.diagnostic_wins (diagnostic_id) where is_first_win;

-- ---- Grants, row security, authorship ----------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'diagnostic_clients', 'diagnostics', 'diagnostic_participants', 'diagnostic_tasks',
    'diagnostic_answers', 'diagnostic_notes', 'diagnostic_quotes', 'diagnostic_wins'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
    execute format('drop trigger if exists stamp_created_by on public.%I', t);
    execute format(
      'create trigger stamp_created_by before insert on public.%I for each row execute function public.stamp_created_by()',
      t
    );
  end loop;
end $$;

grant delete on public.diagnostic_tasks, public.diagnostic_quotes to authenticated;

-- Roles: system_admin only, on every table, for every verb granted.

drop policy if exists diagnostic_clients_select on public.diagnostic_clients;
create policy diagnostic_clients_select on public.diagnostic_clients
  for select to authenticated using ((select public.auth_role()) = 'system_admin');
drop policy if exists diagnostic_clients_insert on public.diagnostic_clients;
create policy diagnostic_clients_insert on public.diagnostic_clients
  for insert to authenticated with check ((select public.auth_role()) = 'system_admin');
drop policy if exists diagnostic_clients_update on public.diagnostic_clients;
create policy diagnostic_clients_update on public.diagnostic_clients
  for update to authenticated
  using ((select public.auth_role()) = 'system_admin')
  with check ((select public.auth_role()) = 'system_admin');

drop policy if exists diagnostics_select on public.diagnostics;
create policy diagnostics_select on public.diagnostics
  for select to authenticated using ((select public.auth_role()) = 'system_admin');
drop policy if exists diagnostics_insert on public.diagnostics;
create policy diagnostics_insert on public.diagnostics
  for insert to authenticated with check ((select public.auth_role()) = 'system_admin');
drop policy if exists diagnostics_update on public.diagnostics;
create policy diagnostics_update on public.diagnostics
  for update to authenticated
  using ((select public.auth_role()) = 'system_admin')
  with check ((select public.auth_role()) = 'system_admin');

drop policy if exists diagnostic_participants_select on public.diagnostic_participants;
create policy diagnostic_participants_select on public.diagnostic_participants
  for select to authenticated using ((select public.auth_role()) = 'system_admin');
drop policy if exists diagnostic_participants_insert on public.diagnostic_participants;
create policy diagnostic_participants_insert on public.diagnostic_participants
  for insert to authenticated with check ((select public.auth_role()) = 'system_admin');
drop policy if exists diagnostic_participants_update on public.diagnostic_participants;
create policy diagnostic_participants_update on public.diagnostic_participants
  for update to authenticated
  using ((select public.auth_role()) = 'system_admin')
  with check ((select public.auth_role()) = 'system_admin');

drop policy if exists diagnostic_tasks_select on public.diagnostic_tasks;
create policy diagnostic_tasks_select on public.diagnostic_tasks
  for select to authenticated using ((select public.auth_role()) = 'system_admin');
drop policy if exists diagnostic_tasks_insert on public.diagnostic_tasks;
create policy diagnostic_tasks_insert on public.diagnostic_tasks
  for insert to authenticated with check ((select public.auth_role()) = 'system_admin');
drop policy if exists diagnostic_tasks_update on public.diagnostic_tasks;
create policy diagnostic_tasks_update on public.diagnostic_tasks
  for update to authenticated
  using ((select public.auth_role()) = 'system_admin')
  with check ((select public.auth_role()) = 'system_admin');
drop policy if exists diagnostic_tasks_delete on public.diagnostic_tasks;
create policy diagnostic_tasks_delete on public.diagnostic_tasks
  for delete to authenticated using ((select public.auth_role()) = 'system_admin');

drop policy if exists diagnostic_answers_select on public.diagnostic_answers;
create policy diagnostic_answers_select on public.diagnostic_answers
  for select to authenticated using ((select public.auth_role()) = 'system_admin');
drop policy if exists diagnostic_answers_insert on public.diagnostic_answers;
create policy diagnostic_answers_insert on public.diagnostic_answers
  for insert to authenticated with check ((select public.auth_role()) = 'system_admin');
drop policy if exists diagnostic_answers_update on public.diagnostic_answers;
create policy diagnostic_answers_update on public.diagnostic_answers
  for update to authenticated
  using ((select public.auth_role()) = 'system_admin')
  with check ((select public.auth_role()) = 'system_admin');

-- Notes and quotes: system_admin only, and nothing once the diagnostic
-- is published.
drop policy if exists diagnostic_notes_select on public.diagnostic_notes;
create policy diagnostic_notes_select on public.diagnostic_notes
  for select to authenticated using ((select public.auth_role()) = 'system_admin');
drop policy if exists diagnostic_notes_insert on public.diagnostic_notes;
create policy diagnostic_notes_insert on public.diagnostic_notes
  for insert to authenticated with check (
    (select public.auth_role()) = 'system_admin'
    and not exists (select 1 from public.diagnostics d
                    where d.id = diagnostic_notes.diagnostic_id and d.published_at is not null)
  );
drop policy if exists diagnostic_notes_update on public.diagnostic_notes;
create policy diagnostic_notes_update on public.diagnostic_notes
  for update to authenticated
  using (
    (select public.auth_role()) = 'system_admin'
    and not exists (select 1 from public.diagnostics d
                    where d.id = diagnostic_notes.diagnostic_id and d.published_at is not null)
  )
  with check ((select public.auth_role()) = 'system_admin');

drop policy if exists diagnostic_quotes_select on public.diagnostic_quotes;
create policy diagnostic_quotes_select on public.diagnostic_quotes
  for select to authenticated using ((select public.auth_role()) = 'system_admin');
drop policy if exists diagnostic_quotes_insert on public.diagnostic_quotes;
create policy diagnostic_quotes_insert on public.diagnostic_quotes
  for insert to authenticated with check (
    (select public.auth_role()) = 'system_admin'
    and not exists (select 1 from public.diagnostics d
                    where d.id = diagnostic_quotes.diagnostic_id and d.published_at is not null)
  );
drop policy if exists diagnostic_quotes_update on public.diagnostic_quotes;
create policy diagnostic_quotes_update on public.diagnostic_quotes
  for update to authenticated
  using (
    (select public.auth_role()) = 'system_admin'
    and not exists (select 1 from public.diagnostics d
                    where d.id = diagnostic_quotes.diagnostic_id and d.published_at is not null)
  )
  with check ((select public.auth_role()) = 'system_admin');
-- Only a line not yet approved is discarded.
drop policy if exists diagnostic_quotes_delete on public.diagnostic_quotes;
create policy diagnostic_quotes_delete on public.diagnostic_quotes
  for delete to authenticated using (
    (select public.auth_role()) = 'system_admin'
    and approved_at is null
    and not exists (select 1 from public.diagnostics d
                    where d.id = diagnostic_quotes.diagnostic_id and d.published_at is not null)
  );

drop policy if exists diagnostic_wins_select on public.diagnostic_wins;
create policy diagnostic_wins_select on public.diagnostic_wins
  for select to authenticated using ((select public.auth_role()) = 'system_admin');
drop policy if exists diagnostic_wins_insert on public.diagnostic_wins;
create policy diagnostic_wins_insert on public.diagnostic_wins
  for insert to authenticated with check ((select public.auth_role()) = 'system_admin');
drop policy if exists diagnostic_wins_update on public.diagnostic_wins;
create policy diagnostic_wins_update on public.diagnostic_wins
  for update to authenticated
  using ((select public.auth_role()) = 'system_admin')
  with check ((select public.auth_role()) = 'system_admin');

-- ---- The canonical-title call's cost log purpose -----------------

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
    'other'
  ));
