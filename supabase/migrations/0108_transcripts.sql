-- =============================================================
-- Migration 0108: meeting transcript ingestion + analysis
--
-- Four tables (transcript_sources, transcript_aliases, meetings,
-- meeting_analyses) plus two column additions on commitments so
-- extracted commitments can land unassigned and link back to their
-- source meeting.
--
-- Privacy model:
--   - Sources and aliases are managed by system_admin. RLS blocks
--     writes for anyone else. The permission is also gated in the
--     app layer via a single guard function so it can widen later.
--   - Meetings + analyses are readable by system_admin AND by
--     company_admin of the routed company. Team members never see
--     them; they only see the resulting commitments and the email.
--   - Aliases are visible to all members of the owning company (so
--     the UI can show what strings route to their company) but only
--     writable by system_admin.
-- =============================================================

-- ---- transcript_sources ------------------------------------
create table if not exists public.transcript_sources (
  id uuid primary key default gen_random_uuid(),
  -- Nullable: a 'shared' source serves multiple companies via alias
  -- routing on the filename.
  company_id uuid references public.companies(id) on delete cascade,
  scope text not null default 'company'
    check (scope in ('company','shared')),
  provider text not null
    check (provider in ('google_drive','teams')),
  folder_id text not null,
  folder_name text,
  cursor text,
  status text not null default 'active'
    check (status in ('active','paused','error')),
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Row shape ties scope to company_id: company scope must have a
  -- company; shared scope must not.
  constraint transcript_sources_scope_shape check (
    (scope = 'company' and company_id is not null)
    or (scope = 'shared' and company_id is null)
  ),
  -- One provider folder registered once.
  constraint transcript_sources_provider_folder_unique
    unique (provider, folder_id)
);

create index if not exists transcript_sources_status_idx
  on public.transcript_sources (status, last_checked_at);

drop trigger if exists transcript_sources_set_updated_at on public.transcript_sources;
create trigger transcript_sources_set_updated_at
before update on public.transcript_sources
for each row execute function public.set_updated_at();

-- ---- transcript_aliases ------------------------------------
-- A company can register any number of aliases that route a
-- shared-folder filename to it. Case-insensitive substring match.
-- Global uniqueness on lower(alias) so no two companies can claim
-- the same string (the routing rule wouldn't be able to decide).
create table if not exists public.transcript_aliases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  alias text not null check (length(trim(alias)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists transcript_aliases_lower_unique
  on public.transcript_aliases (lower(alias));

create index if not exists transcript_aliases_company_idx
  on public.transcript_aliases (company_id);

drop trigger if exists transcript_aliases_set_updated_at on public.transcript_aliases;
create trigger transcript_aliases_set_updated_at
before update on public.transcript_aliases
for each row execute function public.set_updated_at();

-- Seed alias-per-company: every company gets its own name as its
-- first alias. Trigger runs on company insert; the backfill below
-- covers companies that predate this migration.
create or replace function public.companies_seed_transcript_alias()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.transcript_aliases (company_id, alias)
  values (new.id, new.name)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists companies_seed_transcript_alias_trg on public.companies;
create trigger companies_seed_transcript_alias_trg
after insert on public.companies
for each row execute function public.companies_seed_transcript_alias();

insert into public.transcript_aliases (company_id, alias)
select c.id, c.name
from public.companies c
where not exists (
  select 1 from public.transcript_aliases a
  where a.company_id = c.id and lower(a.alias) = lower(c.name)
);

-- ---- meetings ----------------------------------------------
create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  -- Nullable: an unrouted meeting has no company yet.
  company_id uuid references public.companies(id) on delete set null,
  source_id uuid not null references public.transcript_sources(id) on delete cascade,
  provider_file_id text not null,
  file_name text not null,
  content_hash text not null,
  routed_by_alias text,
  meeting_title text,
  transcript_text text not null,
  status text not null default 'pending'
    check (status in ('unrouted','pending','analyzing','complete','failed')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Same file id never ingested twice from the same source.
  constraint meetings_source_file_unique
    unique (source_id, provider_file_id)
);

create index if not exists meetings_status_idx on public.meetings (status);
create index if not exists meetings_company_status_idx
  on public.meetings (company_id, status);
-- Per-company duplicate check: after routing, a repeat of the same
-- content shouldn't create a second meeting for the same company.
create unique index if not exists meetings_company_content_unique
  on public.meetings (company_id, content_hash)
  where company_id is not null;

drop trigger if exists meetings_set_updated_at on public.meetings;
create trigger meetings_set_updated_at
before update on public.meetings
for each row execute function public.set_updated_at();

-- ---- meeting_analyses --------------------------------------
create table if not exists public.meeting_analyses (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null unique references public.meetings(id) on delete cascade,
  analysis_markdown text not null,
  commitments_json jsonb not null default '[]'::jsonb,
  model text not null,
  created_at timestamptz not null default now()
);

create index if not exists meeting_analyses_meeting_idx
  on public.meeting_analyses (meeting_id);

-- ---- commitments: nullable owner + source link -------------
alter table public.commitments
  alter column owner_id drop not null;

alter table public.commitments
  add column if not exists source_meeting_id uuid
    references public.meetings(id) on delete set null;

create index if not exists commitments_source_meeting_idx
  on public.commitments (source_meeting_id);

-- =============================================================
-- RLS
-- =============================================================
alter table public.transcript_sources enable row level security;
alter table public.transcript_sources force row level security;
alter table public.transcript_aliases enable row level security;
alter table public.transcript_aliases force row level security;
alter table public.meetings enable row level security;
alter table public.meetings force row level security;
alter table public.meeting_analyses enable row level security;
alter table public.meeting_analyses force row level security;

-- ---- transcript_sources: system_admin write; system_admin +
--      routed company_admin read.
create policy transcript_sources_select on public.transcript_sources
for select to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (
         ap.role = 'company_admin'
         and public.transcript_sources.company_id is not null
         and ap.company_id = public.transcript_sources.company_id
       )
  )
);

create policy transcript_sources_insert on public.transcript_sources
for insert to authenticated
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
  )
);

create policy transcript_sources_update on public.transcript_sources
for update to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
  )
)
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
  )
);

create policy transcript_sources_delete on public.transcript_sources
for delete to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
  )
);

-- ---- transcript_aliases: every company member reads their own
--      company's aliases; only system_admin writes.
create policy transcript_aliases_select on public.transcript_aliases
for select to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.company_id is not null
           and ap.company_id = public.transcript_aliases.company_id)
  )
);

create policy transcript_aliases_insert on public.transcript_aliases
for insert to authenticated
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
  )
);

create policy transcript_aliases_update on public.transcript_aliases
for update to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
  )
)
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
  )
);

create policy transcript_aliases_delete on public.transcript_aliases
for delete to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
  )
);

-- ---- meetings: system_admin reads all; routed company_admin
--      reads their own company's rows. Writes are service-role
--      only (cron/analysis pipeline), so no insert/update/delete
--      policies for authenticated — RLS default-deny.
create policy meetings_select on public.meetings
for select to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (
         ap.role = 'company_admin'
         and public.meetings.company_id is not null
         and ap.company_id = public.meetings.company_id
       )
  )
);

-- Manual routing from the system-admin UI: system_admin only.
create policy meetings_update_admin on public.meetings
for update to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
  )
)
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
  )
);

-- ---- commitments: allow team members to claim unassigned rows.
-- Admins already reach null-owner rows via the existing admin policy.
-- Owner-based policies fail on null owners because owner_id = auth.uid()
-- is null when owner_id is null. This policy lets a same-company
-- member update a null-owner row only when the new owner is themselves.
drop policy if exists commitments_claim_unassigned on public.commitments;
create policy commitments_claim_unassigned on public.commitments
for update to authenticated
using (
  public.commitments.owner_id is null
  and exists (
    select 1 from public.auth_profile() ap
    where ap.company_id = public.commitments.company_id
  )
)
with check (
  public.commitments.owner_id = auth.uid()
);

-- ---- meeting_analyses: mirrors meetings visibility.
create policy meeting_analyses_select on public.meeting_analyses
for select to authenticated
using (
  exists (
    select 1
    from public.meetings m
    join public.auth_profile() ap on true
    where m.id = public.meeting_analyses.meeting_id
      and (
        ap.role = 'system_admin'
        or (
          ap.role = 'company_admin'
          and m.company_id is not null
          and ap.company_id = m.company_id
        )
      )
  )
);

-- Writes are service-role only.
