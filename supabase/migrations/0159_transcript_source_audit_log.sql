-- =============================================================
-- Migration 0159: audit log for transcript_source lifecycle.
--
-- Why this exists: on 2026-08-27 a transcript_source for Benson
-- was removed and re-connected. The removal cascade-wiped every
-- historical meeting (fixed in 0158). Nobody on the team
-- remembered doing it; the console.warn lines added in the same
-- fix are only useful for 24h on the free Vercel log retention,
-- so a "who did what and when" question a week later has no
-- authoritative answer.
--
-- This table gives every source-lifecycle mutation a permanent
-- server-side record: what happened, to which source, by which
-- profile, when, with a JSONB snapshot of the row for context.
-- Sysadmin-only read; writes go through the admin client from
-- the transcripts server actions.
--
-- Deliberately not linked to transcript_sources by FK — an audit
-- row for a delete MUST survive the delete of the underlying
-- source. source_id is stored as a plain uuid so the record
-- persists even after the source is gone.
-- =============================================================

create table public.transcript_source_audit_log (
  id            uuid primary key default gen_random_uuid(),
  -- Snapshot of what happened. "created" fires from
  -- connectGoogleFolderAction; "removed" from removeSourceAction.
  -- Extend the enum as pause/resume/reroute paths add themselves.
  event_type    text not null check (event_type in ('created','removed','paused','resumed')),
  -- Untied uuid: this row must outlive the transcript_sources row
  -- it references. Do NOT add a foreign key.
  source_id     uuid not null,
  -- Denormalized so a filter/lookup by company doesn't need a
  -- join back to a (possibly deleted) source row.
  company_id    uuid references public.companies(id) on delete set null,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  -- Everything else that might matter: provider, folder_id,
  -- folder_name, previous status, error text, etc. Free-form
  -- JSONB so the shape can evolve without a migration.
  payload       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index transcript_source_audit_log_source_idx
  on public.transcript_source_audit_log (source_id, created_at desc);

create index transcript_source_audit_log_company_idx
  on public.transcript_source_audit_log (company_id, created_at desc);

create index transcript_source_audit_log_created_idx
  on public.transcript_source_audit_log (created_at desc);

-- ---- RLS ---------------------------------------------------
alter table public.transcript_source_audit_log enable row level security;
alter table public.transcript_source_audit_log force row level security;

-- Sysadmin can read the whole thing. No policy for INSERT/UPDATE/
-- DELETE — writes go via the service-role admin client, which
-- bypasses RLS. Nobody but a sysadmin should be reading this and
-- nobody but the service should be writing it.
create policy transcript_source_audit_log_select
on public.transcript_source_audit_log
for select to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
  )
);
