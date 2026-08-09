-- =============================================================
-- Migration 0127 — role_description_documents
--
-- Cache table for the generated AiMS Role Description JSON. Sonnet
-- generation costs money and takes several seconds, and the
-- underlying chart entities only change occasionally — so we hold
-- the last generation on disk and only regenerate when either:
--   (a) any of the function's chart entities have an updated_at
--       newer than generated_at (auto-invalidate on next visit), or
--   (b) an admin hits the "Regenerate" button on the view page
--       (manual invalidate).
--
-- One row per function — the doc is a snapshot of the assembled
-- output, not a versioned history. Versioning is a separate feature
-- if/when we need it.
-- =============================================================

create table if not exists public.role_description_documents (
  id uuid primary key default gen_random_uuid(),
  function_id uuid not null unique references public.functions(id) on delete cascade,
  -- Structured RD document per RdDocument in
  -- src/lib/role-descriptions/generate.ts. jsonb so we can pick
  -- fields out for future features (search, diffs) without a
  -- schema migration each time the doc shape grows.
  document jsonb not null,
  generated_at timestamptz not null default now(),
  generated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists role_description_documents_function_idx
  on public.role_description_documents (function_id);

drop trigger if exists role_description_documents_set_updated_at
  on public.role_description_documents;
create trigger role_description_documents_set_updated_at
before update on public.role_description_documents
for each row execute function public.set_updated_at();

-- =============================================================
-- RLS — mirror function_competencies / function_decision_rights.
-- Read: any company member of the function's company.
-- Write: system_admin, company_admin (of the function's company),
--        or aims_guide with an assignment.
-- =============================================================
alter table public.role_description_documents enable row level security;
alter table public.role_description_documents force row level security;

drop policy if exists role_description_documents_select
  on public.role_description_documents;
create policy role_description_documents_select
  on public.role_description_documents
for select to authenticated
using (
  exists (
    select 1
    from public.auth_profile() ap
    join public.functions f on f.id = public.role_description_documents.function_id
    where ap.role = 'system_admin'
       or (ap.company_id is not null and ap.company_id = f.company_id)
  )
);

drop policy if exists role_description_documents_insert
  on public.role_description_documents;
create policy role_description_documents_insert
  on public.role_description_documents
for insert to authenticated
with check (
  exists (
    select 1
    from public.auth_profile() ap
    join public.functions f on f.id = public.role_description_documents.function_id
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = f.company_id)
  )
);

drop policy if exists role_description_documents_insert_guide
  on public.role_description_documents;
create policy role_description_documents_insert_guide
  on public.role_description_documents
for insert to authenticated
with check (
  public.is_guide_for(
    (select company_id from public.functions
      where id = public.role_description_documents.function_id)
  )
);

drop policy if exists role_description_documents_update
  on public.role_description_documents;
create policy role_description_documents_update
  on public.role_description_documents
for update to authenticated
using (
  exists (
    select 1
    from public.auth_profile() ap
    join public.functions f on f.id = public.role_description_documents.function_id
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = f.company_id)
  )
)
with check (
  exists (
    select 1
    from public.auth_profile() ap
    join public.functions f on f.id = public.role_description_documents.function_id
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = f.company_id)
  )
);

drop policy if exists role_description_documents_update_guide
  on public.role_description_documents;
create policy role_description_documents_update_guide
  on public.role_description_documents
for update to authenticated
using (
  public.is_guide_for(
    (select company_id from public.functions
      where id = public.role_description_documents.function_id)
  )
)
with check (
  public.is_guide_for(
    (select company_id from public.functions
      where id = public.role_description_documents.function_id)
  )
);

drop policy if exists role_description_documents_delete
  on public.role_description_documents;
create policy role_description_documents_delete
  on public.role_description_documents
for delete to authenticated
using (
  exists (
    select 1
    from public.auth_profile() ap
    join public.functions f on f.id = public.role_description_documents.function_id
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = f.company_id)
  )
);

drop policy if exists role_description_documents_delete_guide
  on public.role_description_documents;
create policy role_description_documents_delete_guide
  on public.role_description_documents
for delete to authenticated
using (
  public.is_guide_for(
    (select company_id from public.functions
      where id = public.role_description_documents.function_id)
  )
);
