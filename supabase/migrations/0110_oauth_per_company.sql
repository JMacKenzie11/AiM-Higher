-- =============================================================
-- Migration 0110: per-company OAuth credentials
--
-- Move from one platform-wide Google identity to one per company.
-- Each company connects its own Google account and points at its
-- own Drive folder(s), so clients whose Workspace policies forbid
-- sharing outside their tenant can still onboard, and the same
-- physical folder can back multiple companies via alias filtering
-- when needed.
--
-- Migration path:
--   1. Add company_id (nullable, FK to companies with cascade).
--   2. Backfill the single existing row to Benson Seafood — the
--      only company connected before the change.
--   3. Enforce NOT NULL, swap primary key from (provider) to (id),
--      add uniqueness on (provider, company_id).
--   4. Loosen transcript_sources uniqueness so the same folder_id
--      can be registered against different companies. Per-company
--      OAuth means each connection can read the folder in its own
--      right, so cross-company duplication is legitimate.
-- =============================================================

-- ---- oauth_credentials --------------------------------------
alter table public.oauth_credentials
  add column if not exists id uuid not null default gen_random_uuid();

alter table public.oauth_credentials
  add column if not exists company_id uuid references public.companies(id) on delete cascade;

-- Backfill the pre-migration platform credential to Benson Seafood.
-- Safe to re-run: only touches rows that still lack a company.
update public.oauth_credentials
set company_id = (
  select id from public.companies
  where lower(name) = lower('Benson Seafood')
  limit 1
)
where company_id is null;

-- If Benson Seafood wasn't found (test envs, fresh installs), delete
-- the orphaned row rather than fail the migration. The operator can
-- reconnect from the company page.
delete from public.oauth_credentials where company_id is null;

alter table public.oauth_credentials
  alter column company_id set not null;

-- Swap primary key: was (provider). New pkey is id; provider is now
-- part of a composite uniqueness with company_id so a company can
-- connect Google once and (later) Teams once alongside it.
alter table public.oauth_credentials
  drop constraint if exists oauth_credentials_pkey;

alter table public.oauth_credentials
  add constraint oauth_credentials_pkey primary key (id);

drop index if exists oauth_credentials_provider_company_key;
create unique index oauth_credentials_provider_company_key
  on public.oauth_credentials (provider, company_id);

create index if not exists oauth_credentials_company_idx
  on public.oauth_credentials (company_id);

-- ---- RLS ----------------------------------------------------
-- System admins keep global read. Company admins can now read
-- their own row so the connect UI knows the account state.
drop policy if exists oauth_credentials_select on public.oauth_credentials;
create policy oauth_credentials_select on public.oauth_credentials
for select to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = oauth_credentials.company_id)
  )
);

-- ---- transcript_sources uniqueness --------------------------
-- Was: unique(provider, folder_id) — blocked the same folder from
-- being registered twice, even against different companies. That
-- assumption no longer holds under per-company OAuth. Include
-- company_id in the uniqueness so a company still can't register
-- the same folder twice, but different companies can each register
-- their own copy.
alter table public.transcript_sources
  drop constraint if exists transcript_sources_provider_folder_unique;

alter table public.transcript_sources
  add constraint transcript_sources_provider_folder_company_unique
  unique (provider, folder_id, company_id);
