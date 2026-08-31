-- =============================================================
-- Migration 0150: coaching conversation shares.
--
-- Sharing is an overlay on top of ownership, not a replacement.
--   * Owner (created_by) keeps full control: rename, archive,
--     manage shares, and of course read + write messages.
--   * A row in coaching_conversation_shares grants a sharee either
--     'read' or 'write' access. Write can post new messages;
--     read can only view.
--
-- Cross-tenant rule (non-negotiable): a share row is only valid
-- when the sharee's profile.company_id equals the conversation's
-- company_id. Enforced in three layers so no path can leak:
--   1. server action does the friendly-error check
--   2. RLS insert policy checks same company against auth_profile
--   3. before-insert trigger revalidates at the row level
--
-- The launcher role gate on a practice (e.g. Functional Chart
-- Builder = admin-only) is untouched. It gates who can create a
-- thread; once a thread exists, this share layer decides who can
-- participate. Practice output-card side effects (e.g. Apply to
-- Chart) keep their own permission checks — a shared team_member
-- can chat in a chart-builder thread, but Apply still requires
-- chart-edit rights.
-- =============================================================

-- ---- Table --------------------------------------------------
create table public.coaching_conversation_shares (
  conversation_id uuid not null references public.coaching_conversations(id) on delete cascade,
  profile_id      uuid not null references public.profiles(id)               on delete cascade,
  access          text not null check (access in ('read','write')),
  created_by      uuid not null references public.profiles(id) on delete restrict,
  created_at      timestamptz not null default now(),
  primary key (conversation_id, profile_id)
);

-- Reverse-direction lookup: "which conversations have been shared
-- with me?" is the driver for the Shared-with-you list. The PK
-- covers the forward direction (conversation → sharees).
create index coaching_conversation_shares_by_profile_idx
  on public.coaching_conversation_shares (profile_id);

-- ---- Same-company invariant trigger ------------------------
-- Defense in depth. The server action and RLS policy also check,
-- but the trigger is the last-mile guarantee: even if a future
-- code path or a direct DB manipulation slips a cross-tenant row,
-- this raises. SECURITY DEFINER so it can read profiles + convos
-- regardless of the caller's own RLS grants.
create or replace function public.assert_coaching_share_same_company()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  convo_company uuid;
  sharee_company uuid;
begin
  select company_id into convo_company
    from public.coaching_conversations
   where id = new.conversation_id;
  select company_id into sharee_company
    from public.profiles
   where id = new.profile_id;

  if convo_company is null then
    raise exception 'coaching_share_invalid_conversation: % not found', new.conversation_id;
  end if;
  if sharee_company is null then
    raise exception 'coaching_share_sharee_no_company: profile % is not in a company', new.profile_id;
  end if;
  if convo_company <> sharee_company then
    raise exception 'coaching_share_cross_tenant: conversation % (company %) cannot be shared to profile % (company %)',
      new.conversation_id, convo_company, new.profile_id, sharee_company;
  end if;
  return new;
end;
$$;

revoke all on function public.assert_coaching_share_same_company() from public;

create trigger coaching_conversation_shares_same_company
  before insert or update on public.coaching_conversation_shares
  for each row execute function public.assert_coaching_share_same_company();

-- ---- RLS on the shares table -------------------------------
alter table public.coaching_conversation_shares enable row level security;
alter table public.coaching_conversation_shares force row level security;

-- SELECT: the conversation's owner sees every share row for it;
-- a sharee sees their own row. Nobody else.
create policy coaching_conversation_shares_select
on public.coaching_conversation_shares
for select to authenticated
using (
  profile_id = auth.uid()
  or exists (
    select 1 from public.coaching_conversations cc
    where cc.id = coaching_conversation_shares.conversation_id
      and cc.created_by = auth.uid()
  )
);

-- INSERT: only the conversation owner may add a share. created_by
-- must be the caller (audit). Same-company is enforced by the
-- trigger; we ALSO check it here so the friendly path returns a
-- policy denial rather than falling through to a trigger raise.
create policy coaching_conversation_shares_insert
on public.coaching_conversation_shares
for insert to authenticated
with check (
  created_by = auth.uid()
  and exists (
    select 1 from public.coaching_conversations cc
    where cc.id = coaching_conversation_shares.conversation_id
      and cc.created_by = auth.uid()
  )
  and exists (
    select 1 from public.profiles sharee
    join public.coaching_conversations cc on cc.id = coaching_conversation_shares.conversation_id
    where sharee.id = coaching_conversation_shares.profile_id
      and sharee.company_id = cc.company_id
  )
);

-- UPDATE: owner may change access level. Same-company still
-- required (trigger reinforces).
create policy coaching_conversation_shares_update
on public.coaching_conversation_shares
for update to authenticated
using (
  exists (
    select 1 from public.coaching_conversations cc
    where cc.id = coaching_conversation_shares.conversation_id
      and cc.created_by = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.coaching_conversations cc
    where cc.id = coaching_conversation_shares.conversation_id
      and cc.created_by = auth.uid()
  )
);

-- DELETE: owner unshares anyone; sharee can self-leave.
create policy coaching_conversation_shares_delete
on public.coaching_conversation_shares
for delete to authenticated
using (
  profile_id = auth.uid()
  or exists (
    select 1 from public.coaching_conversations cc
    where cc.id = coaching_conversation_shares.conversation_id
      and cc.created_by = auth.uid()
  )
);

-- ---- Extend coaching_conversations SELECT ------------------
-- Owner keeps SELECT; sharees (any access level) gain it too.
-- UPDATE stays owner-only (rename, archive) — no change here.
drop policy if exists coaching_conversations_select on public.coaching_conversations;

create policy coaching_conversations_select on public.coaching_conversations
for select to authenticated
using (
  created_by = auth.uid()
  or exists (
    select 1 from public.coaching_conversation_shares s
    where s.conversation_id = coaching_conversations.id
      and s.profile_id = auth.uid()
  )
);

-- ---- Extend coaching_messages SELECT + INSERT --------------
-- SELECT: read follows conversation visibility.
-- INSERT: owner OR sharee with access='write'. created_by must
-- still be the caller (attribution belt).
drop policy if exists coaching_messages_select on public.coaching_messages;
drop policy if exists coaching_messages_insert on public.coaching_messages;

create policy coaching_messages_select on public.coaching_messages
for select to authenticated
using (
  exists (
    select 1 from public.coaching_conversations cc
    where cc.id = coaching_messages.conversation_id
      and (
        cc.created_by = auth.uid()
        or exists (
          select 1 from public.coaching_conversation_shares s
          where s.conversation_id = cc.id
            and s.profile_id = auth.uid()
        )
      )
  )
);

create policy coaching_messages_insert on public.coaching_messages
for insert to authenticated
with check (
  created_by = auth.uid()
  and exists (
    select 1 from public.coaching_conversations cc
    where cc.id = coaching_messages.conversation_id
      and (
        cc.created_by = auth.uid()
        or exists (
          select 1 from public.coaching_conversation_shares s
          where s.conversation_id = cc.id
            and s.profile_id = auth.uid()
            and s.access = 'write'
        )
      )
  )
);
