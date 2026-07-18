-- =============================================================
-- Merger Phase 5a — Migration 0101: Strengths Map schema.
--
-- Imports Strengths Map's domain tables into AiMSHigher. Every SM
-- table gets a `strengths_` prefix so nothing collides with the
-- execution namespace (especially `teams`, which was too generic to
-- import as-is). Coaching tables stay in the shared primitive
-- (migration 0012 + 0018) — SM's per-user self-coaching maps to
-- (context_kind = 'strengths', subject = created_by).
--
-- Companies and profiles are the existing AiMSHigher rows; SM's
-- structured profile fields already merged in migration 0017.
--
-- Numbering starts at 0101 so future Strengths migrations have room
-- (0102-0199) without ever colliding with execution migrations
-- (0001-0099 and up).
-- =============================================================

-- ---- items ----------------------------------------------------
-- 64-item question bank. Seeded in migration 0103.
create table if not exists public.strengths_items (
  id text primary key,
  dimension text not null check (dimension in ('thinking','influence','execution','relating')),
  sub_strength text not null,
  item_type text not null check (item_type in ('competence','energy','orientation')),
  text text not null,
  text_b text,
  direct_side text check (direct_side in ('A','B')),
  legacy_tags text[],
  sort_order int not null
);

create index if not exists strengths_items_sort_idx on public.strengths_items(sort_order);

-- ---- assessments ----------------------------------------------
create table if not exists public.strengths_assessments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  version int not null default 1,
  status text not null default 'in_progress' check (status in ('in_progress','completed')),
  started_at timestamptz default now(),
  completed_at timestamptz,
  unique (user_id, version)
);

create index if not exists strengths_assessments_user_idx on public.strengths_assessments(user_id);
create index if not exists strengths_assessments_company_idx on public.strengths_assessments(company_id);

-- ---- responses ------------------------------------------------
create table if not exists public.strengths_responses (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.strengths_assessments(id) on delete cascade,
  item_id text not null references public.strengths_items(id),
  value int not null,
  answered_at timestamptz default now(),
  unique (assessment_id, item_id)
);

create index if not exists strengths_responses_assessment_idx on public.strengths_responses(assessment_id);

-- ---- narrative_messages ---------------------------------------
create table if not exists public.strengths_narrative_messages (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.strengths_assessments(id) on delete cascade,
  role text not null check (role in ('assistant','user')),
  content text not null,
  created_at timestamptz default now()
);

create index if not exists strengths_narrative_assessment_idx on public.strengths_narrative_messages(assessment_id);

-- ---- results --------------------------------------------------
-- Cached scoring output. One row per completed assessment. Writes
-- happen server-side under the service role.
create table if not exists public.strengths_results (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null unique references public.strengths_assessments(id) on delete cascade,
  profile jsonb not null,
  summary text not null,
  model text not null,
  generated_at timestamptz default now()
);

-- ---- team_insights (company-wide) -----------------------------
-- One row per company; regenerated only when a new assessment
-- finishes (tracked via source_max_completed_at).
create table if not exists public.strengths_team_insights (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references public.companies(id) on delete cascade,
  narrative text not null,
  stats jsonb not null,
  model text not null,
  source_max_completed_at timestamptz,
  generated_at timestamptz not null default now()
);

create index if not exists strengths_team_insights_company_idx on public.strengths_team_insights(company_id);

-- ---- teams (mission-scoped rosters) ---------------------------
create table if not exists public.strengths_teams (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  mission_type text not null check (mission_type in ('launch','stabilize','turnaround','growth','general')),
  mission_notes text,
  status text not null default 'draft' check (status in ('draft','active','archived')),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists strengths_teams_company_idx on public.strengths_teams(company_id);
create index if not exists strengths_teams_status_idx on public.strengths_teams(status);

-- ---- team_members ---------------------------------------------
create table if not exists public.strengths_team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.strengths_teams(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  pinned boolean not null default false,
  added_at timestamptz not null default now(),
  unique (team_id, profile_id)
);

create index if not exists strengths_team_members_team_idx on public.strengths_team_members(team_id);
create index if not exists strengths_team_members_profile_idx on public.strengths_team_members(profile_id);

-- ---- team_evaluations -----------------------------------------
-- Cached deterministic scoring + Claude narrative for a team's
-- current roster. `roster_hash` is a stable digest of the member set
-- so the same composition doesn't re-score. Writes are server-side.
create table if not exists public.strengths_team_evaluations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.strengths_teams(id) on delete cascade,
  roster_hash text not null,
  signals jsonb not null,
  narrative text,
  model text,
  generated_at timestamptz not null default now()
);

create index if not exists strengths_team_evaluations_team_idx on public.strengths_team_evaluations(team_id);
create index if not exists strengths_team_evaluations_lookup_idx on public.strengths_team_evaluations(team_id, roster_hash);
