-- =============================================================
-- Migration 0129 — role_description_versions
--
-- Immutable snapshots of the assembled Role Description at a
-- moment in time. Written when an admin hits "Publish" on the RD
-- view page; frozen thereafter (no updates, no edits — clone into
-- a new version if you want to change it).
--
-- Both the raw generated document and any user overrides that
-- were live at publish time are captured so the snapshot renders
-- byte-identically to what the publisher saw. version_number is
-- unique per function and monotonic (highest wins on the
-- versions list).
-- =============================================================

create table if not exists public.role_description_versions (
  id uuid primary key default gen_random_uuid(),
  function_id uuid not null references public.functions(id) on delete cascade,
  version_number int not null,
  snapshot_document jsonb not null,
  snapshot_overrides jsonb,
  notes text,
  published_by uuid references public.profiles(id) on delete set null,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists role_description_versions_function_version_idx
  on public.role_description_versions (function_id, version_number);

create index if not exists role_description_versions_function_published_idx
  on public.role_description_versions (function_id, published_at desc);

-- =============================================================
-- RLS — mirror role_description_documents. Read: any company
-- member of the function's company. Write: system_admin,
-- company_admin, or aims_guide with an assignment.
-- =============================================================
alter table public.role_description_versions enable row level security;
alter table public.role_description_versions force row level security;

drop policy if exists role_description_versions_select
  on public.role_description_versions;
create policy role_description_versions_select
  on public.role_description_versions
for select to authenticated
using (
  exists (
    select 1
    from public.auth_profile() ap
    join public.functions f on f.id = public.role_description_versions.function_id
    where ap.role = 'system_admin'
       or (ap.company_id is not null and ap.company_id = f.company_id)
  )
);

drop policy if exists role_description_versions_insert
  on public.role_description_versions;
create policy role_description_versions_insert
  on public.role_description_versions
for insert to authenticated
with check (
  exists (
    select 1
    from public.auth_profile() ap
    join public.functions f on f.id = public.role_description_versions.function_id
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = f.company_id)
  )
);

drop policy if exists role_description_versions_insert_guide
  on public.role_description_versions;
create policy role_description_versions_insert_guide
  on public.role_description_versions
for insert to authenticated
with check (
  public.is_guide_for(
    (select company_id from public.functions
      where id = public.role_description_versions.function_id)
  )
);

drop policy if exists role_description_versions_delete
  on public.role_description_versions;
create policy role_description_versions_delete
  on public.role_description_versions
for delete to authenticated
using (
  exists (
    select 1
    from public.auth_profile() ap
    join public.functions f on f.id = public.role_description_versions.function_id
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = f.company_id)
  )
);

drop policy if exists role_description_versions_delete_guide
  on public.role_description_versions;
create policy role_description_versions_delete_guide
  on public.role_description_versions
for delete to authenticated
using (
  public.is_guide_for(
    (select company_id from public.functions
      where id = public.role_description_versions.function_id)
  )
);

-- No update policy — versions are immutable snapshots.
