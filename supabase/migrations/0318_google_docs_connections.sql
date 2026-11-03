-- =============================================================
-- Migration 0318: Save to Google Docs for the Vivid Vision Coach
--
-- WHY. Jason, 2026-11-03: a leader can save their Vivid Vision as a
-- Google Doc in their own Drive, beside Download PDF. Connected once
-- per person; a revised vision updates the same doc, so a link shared
-- with the team keeps working.
--
-- It uses its own Google app (GOOGLE_DOCS_CLIENT_ID), asking only for
-- openid, email and drive.file: the files AiMS-HQ creates, nothing
-- else in the Drive. The transcript app asks for drive.readonly, a
-- restricted scope, which leaders must never be shown.
--
-- ---- 1. google_docs_connections ----------------------------------
--
-- One row per PERSON (unlike 0257's per-company connections): the
-- Google account they connected, and a pointer to the vault secret
-- holding their refresh token and last access token. No secret in
-- the row.
--
-- Read: the person themself, and nobody else (not a system admin:
-- whose Google account a leader uses is theirs).
-- Write: nobody directly. Through the functions below only.
--
-- ---- 2. vivid_vision_google_docs ---------------------------------
--
-- Which Google Doc a person made from a conversation's vision, so
-- the next save updates it. Per person: drive.file lets a person's
-- token reach only files made with THEIR token, so somebody the
-- conversation is shared with gets a doc of their own.
--
-- Read: the person themself. Write: service_role only, from the save
-- route, after it has read the conversation as the caller (RLS on
-- coaching_conversations is the gate).
--
-- ---- 3. The functions --------------------------------------------
--
--   google_docs_put_service      service_role: the sign-in callback,
--                                after its route checked the person.
--   google_docs_secret           service_role: the decrypted secret.
--   google_docs_remove_service   service_role: Google revoked the
--                                token; npm run scrub:dev.
--   google_docs_disconnect       authenticated: the caller's own
--                                connection, and nobody else's.
--
-- The dev clone copies the vault key, so scrub:dev removes these too.
-- =============================================================

create table if not exists public.google_docs_connections (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  account_email text,
  -- vault.secrets(id), kept in step by the functions below.
  secret_id uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.google_docs_connections is
  'A person''s Google account for Save to Google Docs (0318). The secret is '
  'in Supabase Vault; this row points at it. Written only by the '
  'google_docs_* functions.';

create table if not exists public.vivid_vision_google_docs (
  conversation_id uuid not null references public.coaching_conversations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  file_id text not null check (length(file_id) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (conversation_id, profile_id)
);

comment on table public.vivid_vision_google_docs is
  'The Google Doc a person saved a conversation''s Vivid Vision to (0318), '
  'so the next save updates the same doc.';

alter table public.google_docs_connections enable row level security;
alter table public.google_docs_connections force row level security;
alter table public.vivid_vision_google_docs enable row level security;
alter table public.vivid_vision_google_docs force row level security;

revoke all on public.google_docs_connections from public, anon, authenticated;
revoke all on public.vivid_vision_google_docs from public, anon, authenticated;
grant select on public.google_docs_connections to authenticated;
grant select on public.vivid_vision_google_docs to authenticated;
grant select, insert, update, delete on public.google_docs_connections to service_role;
grant select, insert, update, delete on public.vivid_vision_google_docs to service_role;

-- Reads: the person themself only. No role reads another's.
drop policy if exists google_docs_connections_select on public.google_docs_connections;
create policy google_docs_connections_select on public.google_docs_connections
  for select to authenticated
  using (profile_id = (select auth.uid()));

-- Reads: the person themself only.
drop policy if exists vivid_vision_google_docs_select on public.vivid_vision_google_docs;
create policy vivid_vision_google_docs_select on public.vivid_vision_google_docs
  for select to authenticated
  using (profile_id = (select auth.uid()));

-- ---- Saving a secret ----------------------------------------------

-- Write: service_role only (the Google Docs sign-in callback, after
-- its route has checked the person).
create or replace function public.google_docs_put_service(
  p_profile_id uuid,
  p_secret text,
  p_account_email text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.google_docs_connections;
begin
  if p_secret is null or length(btrim(p_secret)) = 0 then
    raise exception 'a connection needs a secret' using errcode = '22023';
  end if;
  select * into v_row from public.google_docs_connections
   where profile_id = p_profile_id
   for update;
  if v_row.profile_id is null then
    insert into public.google_docs_connections (profile_id)
    values (p_profile_id)
    returning * into v_row;
  end if;
  if v_row.secret_id is null then
    update public.google_docs_connections
       set secret_id = vault.create_secret(
             p_secret,
             'google_docs:' || p_profile_id::text,
             'Google Docs connection for profile ' || p_profile_id::text
           ),
           account_email = p_account_email,
           updated_at = now()
     where profile_id = p_profile_id;
  else
    perform vault.update_secret(v_row.secret_id, p_secret);
    update public.google_docs_connections
       set account_email = coalesce(p_account_email, account_email),
           updated_at = now()
     where profile_id = p_profile_id;
  end if;
  return true;
end;
$$;

revoke all on function public.google_docs_put_service(uuid, text, text) from public, anon, authenticated;
grant execute on function public.google_docs_put_service(uuid, text, text) to service_role;

-- Read: service_role only. The decrypted secret, for the save route
-- acting for that person.
create or replace function public.google_docs_secret(p_profile_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select ds.decrypted_secret
    from public.google_docs_connections c
    join vault.decrypted_secrets ds on ds.id = c.secret_id
   where c.profile_id = p_profile_id
$$;

revoke all on function public.google_docs_secret(uuid) from public, anon, authenticated;
grant execute on function public.google_docs_secret(uuid) to service_role;

-- ---- Removing a connection -----------------------------------------

-- Granted to nobody. Deletes the secret, then the row. The person's
-- saved doc links stay: reconnecting the same Google account reaches
-- the same docs again.
create or replace function public._google_docs_remove(p_profile_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.google_docs_connections;
begin
  select * into v_row from public.google_docs_connections
   where profile_id = p_profile_id
   for update;
  if v_row.profile_id is null then
    return false;
  end if;
  if v_row.secret_id is not null then
    delete from vault.secrets where id = v_row.secret_id;
  end if;
  delete from public.google_docs_connections where profile_id = p_profile_id;
  return true;
end;
$$;

revoke all on function public._google_docs_remove(uuid) from public, anon, authenticated, service_role;

-- Write: service_role only (Google refused the token; scrub:dev).
create or replace function public.google_docs_remove_service(p_profile_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select public._google_docs_remove(p_profile_id)
$$;

revoke all on function public.google_docs_remove_service(uuid) from public, anon, authenticated;
grant execute on function public.google_docs_remove_service(uuid) to service_role;

-- Write: any signed-in person, on their OWN connection only. The
-- profile comes from auth.uid(), never from an argument.
create or replace function public.google_docs_disconnect()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  return public._google_docs_remove((select auth.uid()));
end;
$$;

revoke all on function public.google_docs_disconnect() from public, anon;
grant execute on function public.google_docs_disconnect() to authenticated;
