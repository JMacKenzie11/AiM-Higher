-- =============================================================
-- Migration 0312: proposals, signed by the lead and then the owner
--
-- WHY. Jason, 2026-10-30 (the approved proposal mockup and sample
-- PDF): a system admin writes a proposal for a Capacity Diagnostic
-- client in set sections, signs it by typing their name, and that
-- publishes it. The client's owner (the owner on the client form)
-- signs in to the portal, reads it, signs it the same way, and either
-- of them downloads it as a PDF. A simple e-signature: the typed name,
-- the time, the IP address the app saw, the browser, and the exact
-- version, fingerprinted. Changing a published proposal makes a new
-- version, which withdraws the old one and is signed again.
--
-- WHAT IT ADDS.
--   diagnostic_proposals     one row per version. A series is every
--                            version of one proposal (series_id, the
--                            first version's id); version counts up
--                            within it.
--   portal_proposals()       the owner's published proposals, listed
--   portal_proposal(id)      one of them, as published
--   portal_sign_proposal()   the owner's signature
--
-- THE FREEZE (diagnostic_proposals_guard). A draft is edited freely.
-- Publishing (published_at set, with the lead's typed name) stamps the
-- lead's signature time and who signed, copies the client's name and
-- owner onto the row, and fingerprints the content (content_hash, a
-- sha256 of the title, version, sections, client and owner). From
-- then on nothing on the row changes (42501) except withdrawn_at, set
-- once, and the owner's signature, set once and only from inside
-- portal_sign_proposal(), by the person it names.
--
-- WHO SIGNS. The person a published proposal is addressed to: a
-- diagnostic_client of that client whose sign-in email is the owner
-- email copied at publishing. Other people at the client see nothing
-- of it.
--
-- ACCESS. The table: system admin only, for every verb, delete only
-- while a draft; 0295's primary-only rule; authorship stamped by
-- stamp_created_by(); outside assistants refused from birth by 0270's
-- event trigger. The owner reaches it through the three functions
-- only. Harness probe "diagnostic proposals · the owner signs".
-- =============================================================

create table if not exists public.diagnostic_proposals (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.diagnostic_clients(id) on delete restrict,
  series_id uuid not null,
  version int not null default 1 check (version >= 1),
  title text not null check (length(btrim(title)) between 1 and 200),
  -- [{ key, title, doc }]: doc is TipTap JSON (lib/diagnostics/proposals.ts).
  sections jsonb not null default '[]'::jsonb check (jsonb_typeof(sections) = 'array'),
  -- Copied from the client at publishing, so the proposal keeps who it
  -- was addressed to.
  client_name text,
  owner_name text,
  owner_email text,
  lead_signed_name text check (lead_signed_name is null or length(btrim(lead_signed_name)) between 1 and 200),
  lead_signed_by uuid references public.profiles(id) on delete set null,
  lead_signed_at timestamptz,
  lead_signed_ip text check (lead_signed_ip is null or length(lead_signed_ip) <= 100),
  lead_signed_agent text check (lead_signed_agent is null or length(lead_signed_agent) <= 500),
  published_at timestamptz,
  content_hash text,
  client_signed_name text check (client_signed_name is null or length(btrim(client_signed_name)) between 1 and 200),
  client_signed_by uuid references public.profiles(id) on delete set null,
  client_signed_email text,
  client_signed_at timestamptz,
  client_signed_ip text check (client_signed_ip is null or length(client_signed_ip) <= 100),
  client_signed_agent text check (client_signed_agent is null or length(client_signed_agent) <= 500),
  withdrawn_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (series_id, version),
  constraint diagnostic_proposals_published_together check (
    (published_at is null) = (lead_signed_at is null)
    and (published_at is null) = (lead_signed_name is null)
    and (published_at is null) = (content_hash is null)
  ),
  constraint diagnostic_proposals_signed_after_published check (
    client_signed_at is null or published_at is not null
  ),
  constraint diagnostic_proposals_signed_together check (
    (client_signed_at is null) = (client_signed_name is null)
  ),
  constraint diagnostic_proposals_withdrawn_after_published check (
    withdrawn_at is null or published_at is not null
  )
);

create index if not exists diagnostic_proposals_client on public.diagnostic_proposals (client_id);
-- One draft per series at a time.
create unique index if not exists diagnostic_proposals_one_draft
  on public.diagnostic_proposals (series_id) where published_at is null;

comment on table public.diagnostic_proposals is
  'Capacity Diagnostic (0312): one version of a proposal to a client. System admins write; frozen once the lead signs; the owner reads and signs through portal_proposal() and portal_sign_proposal().';

-- ---- New versions -------------------------------------------------

-- A first version starts its own series; a later one joins a series of
-- the same client and takes the next number.
create or replace function public.diagnostic_proposals_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  series_client uuid;
begin
  if new.series_id is null then
    new.series_id := new.id;
    new.version := 1;
  else
    select client_id into series_client from public.diagnostic_proposals where series_id = new.series_id limit 1;
    if series_client is not null and series_client <> new.client_id then
      raise exception 'diagnostic_proposal_series: a version belongs to its series'' client'
        using errcode = '23514';
    end if;
    new.version := coalesce((select max(version) from public.diagnostic_proposals where series_id = new.series_id), 0) + 1;
  end if;
  if new.published_at is not null or new.lead_signed_at is not null or new.client_signed_at is not null or new.withdrawn_at is not null then
    raise exception 'diagnostic_proposal_draft: a proposal starts as a draft'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.diagnostic_proposals_number() from public, anon, authenticated;

drop trigger if exists diagnostic_proposals_number on public.diagnostic_proposals;
create trigger diagnostic_proposals_number
  before insert on public.diagnostic_proposals
  for each row execute function public.diagnostic_proposals_number();

-- ---- The freeze ---------------------------------------------------

create or replace function public.diagnostic_proposals_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  signing boolean := coalesce(current_setting('aims.proposal_signing', true), '') = 'on';
begin
  new.updated_at := now();
  if new.id <> old.id or new.client_id <> old.client_id or new.series_id <> old.series_id or new.version <> old.version then
    raise exception 'diagnostic_proposal_frozen: a proposal keeps its client, series and version'
      using errcode = '42501';
  end if;

  if old.published_at is null then
    if new.client_signed_at is not null or new.client_signed_name is not null or new.withdrawn_at is not null then
      raise exception 'diagnostic_proposal_draft: a draft is not signed or withdrawn'
        using errcode = '23514';
    end if;
    if new.published_at is null then
      return new;
    end if;
    -- Publishing: the lead's signature, the addressee, the fingerprint.
    if new.lead_signed_name is null or length(btrim(new.lead_signed_name)) = 0 then
      raise exception 'diagnostic_proposal_lead_signature: publishing needs the lead''s typed name'
        using errcode = '23514';
    end if;
    select name, owner_name, owner_email into c from public.diagnostic_clients where id = new.client_id;
    if c.owner_email is null or length(btrim(c.owner_email)) = 0 then
      raise exception 'diagnostic_proposal_owner_email: the client has no owner email to send it to'
        using errcode = '23514';
    end if;
    new.published_at := now();
    new.lead_signed_at := new.published_at;
    new.lead_signed_by := auth.uid();
    new.lead_signed_name := btrim(new.lead_signed_name);
    new.client_name := c.name;
    new.owner_name := c.owner_name;
    new.owner_email := lower(btrim(c.owner_email));
    new.content_hash := encode(sha256(convert_to(jsonb_build_object(
      'title', new.title, 'version', new.version, 'sections', new.sections,
      'client', new.client_name, 'owner', new.owner_name, 'owner_email', new.owner_email
    )::text, 'UTF8')), 'hex');
    return new;
  end if;

  -- Published: frozen but for withdrawal and the owner's signature.
  -- The three *_by columns may only go to null: a removed account's
  -- ON DELETE SET NULL, which keeps the typed name and email.
  if new.title is distinct from old.title or new.sections is distinct from old.sections
     or new.client_name is distinct from old.client_name or new.owner_name is distinct from old.owner_name
     or new.owner_email is distinct from old.owner_email
     or new.lead_signed_name is distinct from old.lead_signed_name
     or (new.lead_signed_by is distinct from old.lead_signed_by and new.lead_signed_by is not null)
     or new.lead_signed_at is distinct from old.lead_signed_at or new.lead_signed_ip is distinct from old.lead_signed_ip
     or new.lead_signed_agent is distinct from old.lead_signed_agent
     or new.published_at is distinct from old.published_at or new.content_hash is distinct from old.content_hash
     or (new.created_by is distinct from old.created_by and new.created_by is not null)
     or new.created_at is distinct from old.created_at then
    raise exception 'diagnostic_proposal_frozen: a published proposal does not change; make a new version'
      using errcode = '42501';
  end if;
  if old.withdrawn_at is not null and new.withdrawn_at is distinct from old.withdrawn_at then
    raise exception 'diagnostic_proposal_frozen: a withdrawn proposal stays withdrawn'
      using errcode = '42501';
  end if;
  if new.client_signed_at is distinct from old.client_signed_at or new.client_signed_name is distinct from old.client_signed_name
     or (new.client_signed_by is distinct from old.client_signed_by and new.client_signed_by is not null)
     or new.client_signed_email is distinct from old.client_signed_email
     or new.client_signed_ip is distinct from old.client_signed_ip or new.client_signed_agent is distinct from old.client_signed_agent then
    if not signing or old.client_signed_at is not null or new.client_signed_by is distinct from auth.uid() then
      raise exception 'diagnostic_proposal_frozen: only the owner signs, once'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.diagnostic_proposals_guard() from public, anon, authenticated;

drop trigger if exists diagnostic_proposals_guard on public.diagnostic_proposals;
create trigger diagnostic_proposals_guard
  before update on public.diagnostic_proposals
  for each row execute function public.diagnostic_proposals_guard();

-- ---- Grants, row security, authorship ----------------------------

alter table public.diagnostic_proposals enable row level security;
alter table public.diagnostic_proposals force row level security;
revoke all on public.diagnostic_proposals from public, anon, authenticated;
grant select, insert, update, delete on public.diagnostic_proposals to authenticated;

drop trigger if exists stamp_created_by on public.diagnostic_proposals;
create trigger stamp_created_by before insert on public.diagnostic_proposals
  for each row execute function public.stamp_created_by();

-- Roles: system_admin only.
drop policy if exists diagnostic_proposals_select on public.diagnostic_proposals;
create policy diagnostic_proposals_select on public.diagnostic_proposals
  for select to authenticated using ((select public.auth_role()) = 'system_admin');
-- Roles: system_admin only.
drop policy if exists diagnostic_proposals_insert on public.diagnostic_proposals;
create policy diagnostic_proposals_insert on public.diagnostic_proposals
  for insert to authenticated with check ((select public.auth_role()) = 'system_admin');
-- Roles: system_admin only (the freeze above limits what changes).
drop policy if exists diagnostic_proposals_update on public.diagnostic_proposals;
create policy diagnostic_proposals_update on public.diagnostic_proposals
  for update to authenticated
  using ((select public.auth_role()) = 'system_admin')
  with check ((select public.auth_role()) = 'system_admin');
-- Roles: system_admin only, and only a draft.
drop policy if exists diagnostic_proposals_delete on public.diagnostic_proposals;
create policy diagnostic_proposals_delete on public.diagnostic_proposals
  for delete to authenticated using ((select public.auth_role()) = 'system_admin' and published_at is null);

-- Roles: none added. Narrows every role's rules to the primary instance
-- (0295).
drop policy if exists diagnostic_proposals_primary_only on public.diagnostic_proposals;
create policy diagnostic_proposals_primary_only on public.diagnostic_proposals
  as restrictive for all to authenticated
  using ((select public.is_primary_instance()))
  with check ((select public.is_primary_instance()));

-- ---- The owner's three functions ---------------------------------

-- The caller's sign-in email, for matching the owner a proposal is
-- addressed to. Internal: not callable by anyone.
create or replace function public.diagnostic_proposal_caller_email()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select lower(btrim(u.email)) from auth.users u where u.id = auth.uid()
$$;

revoke all on function public.diagnostic_proposal_caller_email() from public, anon, authenticated;

-- One proposal as the owner sees it: published, of their own client,
-- addressed to their email. Never a draft, never the lead's notes.
create or replace function public.diagnostic_proposal_view(p public.diagnostic_proposals)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', p.id, 'series_id', p.series_id, 'version', p.version, 'title', p.title, 'sections', p.sections,
    'client_name', p.client_name, 'owner_name', p.owner_name, 'owner_email', p.owner_email,
    'lead_signed_name', p.lead_signed_name, 'lead_signed_at', p.lead_signed_at, 'lead_signed_ip', p.lead_signed_ip,
    'published_at', p.published_at, 'content_hash', p.content_hash,
    'client_signed_name', p.client_signed_name, 'client_signed_email', p.client_signed_email,
    'client_signed_at', p.client_signed_at, 'client_signed_ip', p.client_signed_ip,
    'withdrawn_at', p.withdrawn_at,
    'latest_id', (
      select l.id from public.diagnostic_proposals l
       where l.series_id = p.series_id and l.published_at is not null and l.withdrawn_at is null
       order by l.version desc limit 1
    )
  )
$$;

revoke all on function public.diagnostic_proposal_view(public.diagnostic_proposals) from public, anon, authenticated;

-- Roles: diagnostic_client, the owner of its own client's published
-- proposals; nobody else gets anything.
create or replace function public.portal_proposals()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'title', p.title, 'version', p.version,
      'published_at', p.published_at, 'client_signed_at', p.client_signed_at
    ) order by p.published_at desc), '[]'::jsonb)
    from public.diagnostic_proposals p
   where p.client_id = public.diagnostic_client_id()
     and p.published_at is not null
     and p.withdrawn_at is null
     and p.owner_email = public.diagnostic_proposal_caller_email()
$$;

revoke all on function public.portal_proposals() from public, anon;
grant execute on function public.portal_proposals() to authenticated;

-- Roles: diagnostic_client, the owner it is addressed to. Withdrawn
-- versions still open, with the id of the version that replaced them.
create or replace function public.portal_proposal(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.diagnostic_proposal_view(p)
    from public.diagnostic_proposals p
   where p.id = p_id
     and p.client_id = public.diagnostic_client_id()
     and p.published_at is not null
     and p.owner_email = public.diagnostic_proposal_caller_email()
$$;

revoke all on function public.portal_proposal(uuid) from public, anon;
grant execute on function public.portal_proposal(uuid) to authenticated;

-- Roles: diagnostic_client, the owner it is addressed to; the only
-- write the role has. Signs the version whose fingerprint the owner
-- was shown (p_hash), once. The IP address and browser are as the app
-- server saw the request.
create or replace function public.portal_sign_proposal(p_id uuid, p_name text, p_hash text, p_ip text, p_agent text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.diagnostic_proposals;
  email text := public.diagnostic_proposal_caller_email();
begin
  select * into p from public.diagnostic_proposals
   where id = p_id
     and client_id = public.diagnostic_client_id()
     and published_at is not null
     and owner_email = email
   for update;
  if not found then
    raise exception 'proposal_not_found' using errcode = 'P0002';
  end if;
  if p.withdrawn_at is not null then
    raise exception 'proposal_withdrawn' using errcode = 'P0001';
  end if;
  if p.client_signed_at is not null then
    raise exception 'proposal_signed' using errcode = 'P0001';
  end if;
  if p_hash is distinct from p.content_hash then
    raise exception 'proposal_changed' using errcode = 'P0001';
  end if;
  if p_name is null or length(btrim(p_name)) not between 2 and 200 then
    raise exception 'proposal_name' using errcode = '22023';
  end if;
  perform set_config('aims.proposal_signing', 'on', true);
  update public.diagnostic_proposals
     set client_signed_name = btrim(p_name),
         client_signed_by = auth.uid(),
         client_signed_email = email,
         client_signed_at = now(),
         client_signed_ip = left(p_ip, 100),
         client_signed_agent = left(p_agent, 500)
   where id = p.id
  returning * into p;
  perform set_config('aims.proposal_signing', 'off', true);
  return public.diagnostic_proposal_view(p);
end;
$$;

revoke all on function public.portal_sign_proposal(uuid, text, text, text, text) from public, anon;
grant execute on function public.portal_sign_proposal(uuid, text, text, text, text) to authenticated;
