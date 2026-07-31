-- =============================================================
-- Migration 0109: OAuth credentials for transcript providers
--
-- Replaces the service-account key path. Google's Secure by Default
-- managed policies block key creation for personal projects, so we
-- authenticate as a real user via OAuth 2.0 refresh tokens instead.
--
-- One row per provider (google_drive, later teams). The system admin
-- signs in once, we store the refresh token, every ingest run uses
-- it to mint an access token and read Drive. Folder access follows
-- the connected user's own Drive permissions — clients share their
-- folders with the admin's Gmail address, same UX as sharing with
-- a coworker.
-- =============================================================

create table if not exists public.oauth_credentials (
  provider text primary key
    check (provider in ('google_drive','teams')),
  -- The Google account email that granted consent — displayed on the
  -- setup page so the operator can confirm which account is wired
  -- up. Also what clients need to share their folders with.
  account_email text not null,
  refresh_token text not null,
  -- Access token + expiry are refreshed on demand; storing the last
  -- one avoids a needless refresh call when the cursor cycle runs
  -- twice within an access-token lifetime (typically ~1 hour).
  access_token text,
  access_token_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists oauth_credentials_set_updated_at on public.oauth_credentials;
create trigger oauth_credentials_set_updated_at
before update on public.oauth_credentials
for each row execute function public.set_updated_at();

-- =============================================================
-- RLS: readable by system_admin only. Writes go through the OAuth
-- callback route running with the service role — no authenticated
-- write policy is needed.
-- =============================================================
alter table public.oauth_credentials enable row level security;
alter table public.oauth_credentials force row level security;

drop policy if exists oauth_credentials_select on public.oauth_credentials;
create policy oauth_credentials_select on public.oauth_credentials
for select to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
  )
);
