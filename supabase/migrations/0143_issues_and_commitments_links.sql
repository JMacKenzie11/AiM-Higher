-- =============================================================
-- Migration 0143: Issues/Solutions discipline + commitments link
-- taxonomy.
--
-- Adds the Issues table (Solution Seeking) plus two nullable link
-- columns on commitments (issue_id, functional_area_id). Enforces
-- "at most one link per commitment" via a check constraint. Enables
-- pg_trgm so the Phase 3 duplicate-awareness check on extracted
-- commitments / issues can use SQL trigram similarity without a
-- follow-up migration.
--
-- Design rules being encoded:
--   * There is ONE commitments table. Issue-linked, priority-linked,
--     functional-area-linked, and unlinked (operational) commitments
--     all live here. Presentation-layer separation only.
--   * At most one of priority_id / issue_id / functional_area_id
--     may be non-null on a given row. Zero is fine (an operational
--     commitment; migration 0010 dropped priority_id NOT NULL for
--     exactly that case).
--   * On deletion of the parent (issue soft-resolves; a function
--     can be hard-deleted), the FK sets the link column to null
--     rather than deleting the commitment — history is never
--     rewritten.
-- =============================================================

-- ---- pg_trgm --------------------------------------------------
-- Used by the meeting-summary duplicate check (Phase 3) to flag
-- extracted commitments/issues that closely match already-open
-- items created within the last 14 days. Threshold lives as a
-- named constant in application code (starts at 0.4). Enabled
-- here so Phase 3 doesn't need its own migration.
create extension if not exists pg_trgm;

-- ---- issues ---------------------------------------------------
-- A named problem, tension, or unresolved question. Carries a
-- desired_outcome ("what we want"). Ranks manually within the
-- company (shared across users, not per-user). Resolves; never
-- hard-deletes. When resolved, its open commitments stay live.
create table public.issues (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  title text not null,
  desired_outcome text,
  status text not null default 'open'
    check (status in ('open','resolved')),
  rank int not null default 0,
  source_meeting_id uuid references public.meetings(id) on delete set null,
  resolved_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index issues_company_status_idx
  on public.issues (company_id, status);
create index issues_company_rank_idx
  on public.issues (company_id, rank);
create index issues_source_meeting_idx
  on public.issues (source_meeting_id)
  where source_meeting_id is not null;

create trigger issues_set_updated_at
before update on public.issues
for each row execute function public.set_updated_at();

-- ---- issues RLS ----------------------------------------------
-- Mirrors the commitments pattern:
--   read : company members read own company; system_admin reads
--          all; is_guide_for admits assigned guides.
--   insert : any company member (creator becomes created_by);
--          admins + guides may insert into their assigned
--          company scope too.
--   update : creator (own issue), company_admin (matching),
--          system_admin, is_guide_for. Covers rank changes,
--          rename, desired_outcome edits, and resolve.
--   No delete policy — issues archive by transitioning to
--   status='resolved'. Historical rows stay on file.
alter table public.issues enable row level security;
alter table public.issues force row level security;

create policy issues_select on public.issues
for select to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.company_id is not null and ap.company_id = public.issues.company_id)
  )
  or public.is_guide_for(public.issues.company_id)
);

create policy issues_insert_member on public.issues
for insert to authenticated
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.company_id = public.issues.company_id
  )
);

create policy issues_insert_admin on public.issues
for insert to authenticated
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.issues.company_id)
  )
  or public.is_guide_for(public.issues.company_id)
);

create policy issues_update_creator on public.issues
for update to authenticated
using (
  public.issues.created_by = auth.uid()
  and exists (
    select 1 from public.auth_profile() ap
    where ap.company_id = public.issues.company_id
  )
)
with check (public.issues.created_by = auth.uid());

create policy issues_update_admin on public.issues
for update to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.issues.company_id)
  )
)
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.issues.company_id)
  )
);

create policy issues_update_guide on public.issues
for update to authenticated
using (public.is_guide_for(public.issues.company_id))
with check (public.is_guide_for(public.issues.company_id));

-- ---- commitments — link taxonomy extension --------------------
-- priority_id was made nullable in migration 0010 (operational
-- commitments), so the "zero links" case is already legal.
-- issue_id and functional_area_id are new nullable FKs; the
-- check constraint below caps the count at one.

alter table public.commitments
  add column issue_id uuid
    references public.issues(id) on delete set null;

alter table public.commitments
  add column functional_area_id uuid
    references public.functions(id) on delete set null;

alter table public.commitments
  add constraint commitments_link_exclusive check (
    (case when priority_id is null then 0 else 1 end)
    + (case when issue_id is null then 0 else 1 end)
    + (case when functional_area_id is null then 0 else 1 end)
    <= 1
  );

create index commitments_issue_idx
  on public.commitments (issue_id)
  where issue_id is not null;

create index commitments_functional_area_idx
  on public.commitments (functional_area_id)
  where functional_area_id is not null;
