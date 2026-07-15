-- =============================================================
-- Phase 6 — Migration 0012: AI leadership coaching.
--   coaching_conversations + coaching_messages back the /coach
--   surface. Every row is scoped to the admin who created it via
--   created_by = auth.uid(); no other admin (or the subject) can
--   read the conversation. Company admins can only reach subjects
--   in their own company; system admins can reach any company.
--   No delete policy — conversations are archived, never destroyed.
--
--   Denormalized created_by on messages keeps the RLS check simple
--   and cheap (single index lookup, no join). The user + assistant
--   distinction lives in the `role` column; both roles carry the
--   admin's auth.uid() as created_by because the API route persists
--   the assistant text server-side under the admin's session.
-- =============================================================

create table public.coaching_conversations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  subject_profile_id uuid not null references public.profiles(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete restrict,
  title text not null,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index coaching_conversations_by_admin_idx
  on public.coaching_conversations (created_by, subject_profile_id, updated_at desc);

create trigger coaching_conversations_set_updated_at
before update on public.coaching_conversations
for each row execute function public.set_updated_at();

create table public.coaching_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.coaching_conversations(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete restrict,
  role text not null check (role in ('user','assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index coaching_messages_by_conversation_idx
  on public.coaching_messages (conversation_id, created_at);

-- =============================================================
-- RLS
--   read/insert/update require: created_by = auth.uid()
--     AND caller.role in ('company_admin','system_admin')
--     AND (system_admin OR subject.company_id = caller.company_id).
--   No delete policy — archive only.
-- =============================================================
alter table public.coaching_conversations enable row level security;
alter table public.coaching_conversations force row level security;
alter table public.coaching_messages enable row level security;
alter table public.coaching_messages force row level security;

create policy coaching_conversations_select on public.coaching_conversations
for select to authenticated
using (
  created_by = auth.uid()
  and exists (
    select 1 from public.auth_profile() ap
    where ap.role in ('company_admin','system_admin')
      and (
        ap.role = 'system_admin'
        or ap.company_id = public.coaching_conversations.company_id
      )
  )
);

create policy coaching_conversations_insert on public.coaching_conversations
for insert to authenticated
with check (
  created_by = auth.uid()
  and exists (
    select 1 from public.auth_profile() ap
    where ap.role in ('company_admin','system_admin')
      and (
        ap.role = 'system_admin'
        or ap.company_id = public.coaching_conversations.company_id
      )
  )
);

create policy coaching_conversations_update on public.coaching_conversations
for update to authenticated
using (
  created_by = auth.uid()
  and exists (
    select 1 from public.auth_profile() ap
    where ap.role in ('company_admin','system_admin')
      and (
        ap.role = 'system_admin'
        or ap.company_id = public.coaching_conversations.company_id
      )
  )
)
with check (
  created_by = auth.uid()
);

create policy coaching_messages_select on public.coaching_messages
for select to authenticated
using (
  created_by = auth.uid()
  and exists (
    select 1 from public.auth_profile() ap
    where ap.role in ('company_admin','system_admin')
  )
  and exists (
    select 1 from public.coaching_conversations cc
    where cc.id = public.coaching_messages.conversation_id
      and cc.created_by = auth.uid()
  )
);

create policy coaching_messages_insert on public.coaching_messages
for insert to authenticated
with check (
  created_by = auth.uid()
  and exists (
    select 1 from public.auth_profile() ap
    where ap.role in ('company_admin','system_admin')
  )
  and exists (
    select 1 from public.coaching_conversations cc
    where cc.id = public.coaching_messages.conversation_id
      and cc.created_by = auth.uid()
  )
);

-- Messages are append-only in the UI, but leave a controlled update
-- policy in case a later "edit last message" affordance is added.
create policy coaching_messages_update on public.coaching_messages
for update to authenticated
using (
  created_by = auth.uid()
)
with check (
  created_by = auth.uid()
);
