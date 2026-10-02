-- =============================================================
-- Migration 0257: connections, with their secrets in Supabase Vault,
-- and the Google tokens moved in
--
-- Phase 1 of the external connections plan
-- (docs/plans/external-connections.md; Jason approved decisions 1, 2
-- and 3 on 2026-10-02).
--
-- ---- 1. connections ------------------------------------------------
--
-- One row per company per connector ('google', 'hubspot'): status,
-- the account it reaches, its scopes, when it was last checked and
-- the last error. NO SECRET IN IT. The secret lives in vault.secrets,
-- encrypted with the project's own key, and the row only points at it
-- (secret_id) with a hint for the screen (the last four characters of
-- a key; null for Google, whose account address says which it is).
--
-- Read: the people who may manage a company's connections (decision
-- 3): a system admin, the company's own company admin, and anyone
-- is_content_admin_for() admits (an assigned guide, or a portfolio
-- admin a system admin switched on as that company's admin). Nobody
-- else; the open-data investigation keeps setup restricted.
-- Write: nobody directly. Every write goes through the functions
-- below, which resolve the company from their own argument checked
-- against the caller, never from a row the caller supplied.
--
-- ---- 2. connection_events ---------------------------------------------
--
-- Saved, replaced, removed, moved in from oauth_credentials: who, when,
-- which company and connector. Never a secret. Read as connections.
--
-- ---- 3. The functions --------------------------------------------------
--
--   connection_put            authenticated; the decision-3 roles only.
--                             Saves or replaces a company's secret.
--   connection_put_service    service_role only: the Google sign-in
--                             callback, which has already checked the
--                             person in its route.
--   connection_refresh_secret service_role only: a refreshed Google
--                             access token written back. No event: it
--                             happens on every ingest.
--   connection_secret         service_role only: the decrypted secret,
--                             for server code acting for that company.
--   connection_remove         authenticated; the decision-3 roles only.
--   connection_remove_service service_role only: npm run scrub:dev,
--                             one connection at a time.
--   _connection_put, _connection_remove   granted to nobody.
--
-- Signed-in users have no privilege on the vault schema at all
-- (checked on all three projects, 2026-10-02: no USAGE for anon or
-- authenticated), so these functions are the only way in.
--
-- ---- 4. The Google tokens move in (decision 2) -----------------------
--
-- Every oauth_credentials row becomes a 'google' connection whose
-- secret is the refresh token, the last access token and its expiry,
-- as JSON. oauth_credentials is LEFT AS IT IS: the way back is to
-- revert the code, which reads it again with nothing else to undo.
-- Its plaintext tokens are cleared by a later migration, after a
-- Saturday's pulls have run from the vault on production.
--
-- ---- The dev clone -------------------------------------------------
--
-- Dev is made with Supabase's "Restore to a new project", which copies
-- the project's Vault key: on 2026-10-02 dev's key matched
-- production's. So a clone can decrypt what it copies. npm run
-- scrub:dev removes every connection's secret on the clone, and checks
-- that the clone's key is not production's.
-- =============================================================

create table if not exists public.connections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  connector text not null check (connector in ('google', 'hubspot')),
  status text not null default 'active' check (status in ('active', 'needs_key', 'error')),
  account_label text,
  scopes text[] not null default '{}',
  -- vault.secrets(id). Not a foreign key: the vault schema is the
  -- extension's, and the functions below keep the two in step.
  secret_id uuid unique,
  secret_hint text check (secret_hint is null or length(secret_hint) <= 8),
  checked_at timestamptz,
  last_error text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, connector)
);

comment on table public.connections is
  'A company''s connection to an outside system (0257). The secret is in '
  'Supabase Vault; this row points at it. Written only by the connection_* '
  'functions.';

create table if not exists public.connection_events (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid references public.connections(id) on delete set null,
  company_id uuid not null references public.companies(id) on delete cascade,
  connector text not null,
  event text not null check (event in ('saved', 'replaced', 'removed', 'moved_in')),
  actor_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists connection_events_company
  on public.connection_events (company_id, created_at desc);

comment on table public.connection_events is
  'Who saved, replaced or removed a connection''s secret, and when (0257). '
  'Never the secret.';

-- Who may manage a company's connections (decision 3). Granted to
-- authenticated; reads nothing a caller could not already see.
create or replace function public.can_manage_connections(target_company_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select (select public.auth_role()) = 'system_admin'
      or ((select public.auth_role()) = 'company_admin'
          and (select public.auth_company_id()) = target_company_id)
      or public.is_content_admin_for(target_company_id)
$$;

revoke all on function public.can_manage_connections(uuid) from public;
grant execute on function public.can_manage_connections(uuid) to authenticated;

alter table public.connections enable row level security;
alter table public.connections force row level security;
alter table public.connection_events enable row level security;
alter table public.connection_events force row level security;

revoke all on public.connections from public, anon, authenticated;
revoke all on public.connection_events from public, anon, authenticated;
grant select on public.connections to authenticated;
grant select on public.connection_events to authenticated;
grant select, insert, update, delete on public.connections to service_role;
grant select, insert on public.connection_events to service_role;

-- Reads: system_admin, the company's company_admin, is_content_admin_for.
drop policy if exists connections_select on public.connections;
create policy connections_select on public.connections
  for select to authenticated
  using (public.can_manage_connections(company_id));

-- Reads: system_admin, the company's company_admin, is_content_admin_for.
drop policy if exists connection_events_select on public.connection_events;
create policy connection_events_select on public.connection_events
  for select to authenticated
  using (public.can_manage_connections(company_id));

-- ---- Saving a secret ------------------------------------------------

-- Granted to nobody. The callers below decide who may.
create or replace function public._connection_put(
  p_company_id uuid,
  p_connector text,
  p_secret text,
  p_hint text,
  p_account_label text,
  p_scopes text[],
  p_actor uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.connections;
  v_secret_id uuid;
  v_event text;
begin
  if p_secret is null or length(btrim(p_secret)) = 0 then
    raise exception 'a connection needs a secret' using errcode = '22023';
  end if;

  select * into v_row from public.connections
   where company_id = p_company_id and connector = p_connector
   for update;

  if v_row.id is null then
    insert into public.connections (company_id, connector, created_by)
    values (p_company_id, p_connector, p_actor)
    returning * into v_row;
  end if;

  if v_row.secret_id is null then
    v_secret_id := vault.create_secret(
      p_secret,
      'connection:' || v_row.id::text,
      p_connector || ' connection for company ' || p_company_id::text
    );
    v_event := 'saved';
  else
    perform vault.update_secret(v_row.secret_id, p_secret);
    v_secret_id := v_row.secret_id;
    v_event := 'replaced';
  end if;

  update public.connections
     set secret_id = v_secret_id,
         secret_hint = p_hint,
         account_label = p_account_label,
         scopes = coalesce(p_scopes, '{}'),
         status = 'active',
         last_error = null,
         checked_at = now(),
         updated_at = now()
   where id = v_row.id;

  insert into public.connection_events (connection_id, company_id, connector, event, actor_profile_id)
  values (v_row.id, p_company_id, p_connector, v_event, p_actor);

  return v_row.id;
end;
$$;

revoke all on function public._connection_put(uuid, text, text, text, text, text[], uuid) from public, anon, authenticated, service_role;

-- Write: system_admin, the company's company_admin, is_content_admin_for
-- (an assigned guide, or a switched-on portfolio admin). Decision 3.
create or replace function public.connection_put(
  p_company_id uuid,
  p_connector text,
  p_secret text,
  p_hint text,
  p_account_label text,
  p_scopes text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not public.can_manage_connections(p_company_id) then
    raise exception 'only a company''s admins can manage its connections' using errcode = '42501';
  end if;
  return public._connection_put(p_company_id, p_connector, p_secret, p_hint, p_account_label, p_scopes, (select auth.uid()));
end;
$$;

revoke all on function public.connection_put(uuid, text, text, text, text, text[]) from public, anon;
grant execute on function public.connection_put(uuid, text, text, text, text, text[]) to authenticated;

-- Write: service_role only (the Google sign-in callback, after its
-- route has checked the person).
create or replace function public.connection_put_service(
  p_company_id uuid,
  p_connector text,
  p_secret text,
  p_hint text,
  p_account_label text,
  p_scopes text[],
  p_actor uuid
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select public._connection_put(p_company_id, p_connector, p_secret, p_hint, p_account_label, p_scopes, p_actor)
$$;

revoke all on function public.connection_put_service(uuid, text, text, text, text, text[], uuid) from public, anon, authenticated;
grant execute on function public.connection_put_service(uuid, text, text, text, text, text[], uuid) to service_role;

-- Write: service_role only. A refreshed Google access token, written
-- back so the next run skips the token endpoint. Replaces the secret
-- of an existing connection and nothing else.
create or replace function public.connection_refresh_secret(
  p_company_id uuid,
  p_connector text,
  p_secret text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
begin
  select secret_id into v_secret_id from public.connections
   where company_id = p_company_id and connector = p_connector;
  if v_secret_id is null then
    return false;
  end if;
  perform vault.update_secret(v_secret_id, p_secret);
  return true;
end;
$$;

revoke all on function public.connection_refresh_secret(uuid, text, text) from public, anon, authenticated;
grant execute on function public.connection_refresh_secret(uuid, text, text) to service_role;

-- ---- Reading a secret ---------------------------------------------

-- Read: service_role only. Server code acting for that company.
create or replace function public.connection_secret(p_company_id uuid, p_connector text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select ds.decrypted_secret
    from public.connections c
    join vault.decrypted_secrets ds on ds.id = c.secret_id
   where c.company_id = p_company_id
     and c.connector = p_connector
$$;

revoke all on function public.connection_secret(uuid, text) from public, anon, authenticated;
grant execute on function public.connection_secret(uuid, text) to service_role;

-- ---- Removing a connection ------------------------------------------

-- Granted to nobody. Deletes the secret, then the row; the event keeps
-- the company and connector.
create or replace function public._connection_remove(p_company_id uuid, p_connector text, p_actor uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.connections;
begin
  select * into v_row from public.connections
   where company_id = p_company_id and connector = p_connector
   for update;
  if v_row.id is null then
    return false;
  end if;
  if v_row.secret_id is not null then
    delete from vault.secrets where id = v_row.secret_id;
  end if;
  insert into public.connection_events (connection_id, company_id, connector, event, actor_profile_id)
  values (v_row.id, p_company_id, p_connector, 'removed', p_actor);
  delete from public.connections where id = v_row.id;
  return true;
end;
$$;

revoke all on function public._connection_remove(uuid, text, uuid) from public, anon, authenticated, service_role;

-- Write: system_admin, the company's company_admin, is_content_admin_for.
create or replace function public.connection_remove(p_company_id uuid, p_connector text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not public.can_manage_connections(p_company_id) then
    raise exception 'only a company''s admins can manage its connections' using errcode = '42501';
  end if;
  return public._connection_remove(p_company_id, p_connector, (select auth.uid()));
end;
$$;

revoke all on function public.connection_remove(uuid, text) from public, anon;
grant execute on function public.connection_remove(uuid, text) to authenticated;

-- Write: service_role only (npm run scrub:dev, one at a time).
create or replace function public.connection_remove_service(p_company_id uuid, p_connector text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select public._connection_remove(p_company_id, p_connector, null)
$$;

revoke all on function public.connection_remove_service(uuid, text) from public, anon, authenticated;
grant execute on function public.connection_remove_service(uuid, text) to service_role;

-- ---- The Google tokens move in (decision 2) ---------------------------

do $$
declare
  r record;
  v_id uuid;
begin
  for r in
    select company_id, account_email, refresh_token, access_token, access_token_expires_at, created_at
      from public.oauth_credentials
     where provider = 'google_drive' and company_id is not null
  loop
    if exists (select 1 from public.connections where company_id = r.company_id and connector = 'google') then
      continue;
    end if;
    v_id := public._connection_put(
      r.company_id,
      'google',
      jsonb_build_object(
        'refresh_token', r.refresh_token,
        'access_token', r.access_token,
        'access_token_expires_at', r.access_token_expires_at
      )::text,
      null,
      r.account_email,
      array['openid', 'email', 'https://www.googleapis.com/auth/drive.readonly'],
      null
    );
    update public.connection_events set event = 'moved_in'
     where connection_id = v_id and event = 'saved';
    update public.connections set created_at = r.created_at where id = v_id;
  end loop;
end $$;
