-- =============================================================
-- Phase 3 — Migration 0006: commitments (Section 4.4 — the heartbeat).
--   Every commitment MUST have a parent priority. week_ending is
--   the Friday of the week the commitment belongs to. Carrying a
--   commitment forward closes the original with status='carried'
--   and inserts a NEW commitment (carried_from_id points back).
--   History is never rewritten; the missed_needs_reason check
--   enforces reasoned closure on the DB side.
-- =============================================================

create table public.commitments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  priority_id uuid not null references public.priorities(id) on delete restrict,
  owner_id uuid not null references public.profiles(id) on delete restrict,
  description text not null,
  week_ending date not null,
  due_date date not null,
  status text not null default 'open'
    check (status in ('open','kept','missed','carried')),
  completed_at timestamptz,
  missed_reason text,
  carried_from_id uuid references public.commitments(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint missed_needs_reason
    check (status <> 'missed' or missed_reason is not null)
);

create index commitments_company_week_idx
  on public.commitments (company_id, week_ending);
create index commitments_owner_week_idx
  on public.commitments (owner_id, week_ending);
create index commitments_priority_idx
  on public.commitments (priority_id);
create index commitments_status_idx
  on public.commitments (company_id, status);
create index commitments_carried_from_idx
  on public.commitments (carried_from_id) where carried_from_id is not null;

create trigger commitments_set_updated_at
before update on public.commitments
for each row execute function public.set_updated_at();

-- =============================================================
-- RLS (Section 5)
--   read: company members read own company
--   insert: owner (for self) OR company_admin/system_admin (anyone in company)
--   update: owner updates own; company_admin/system_admin update any in company
--   delete: owner (own, still open) OR admins
-- The "current open week only" delete restriction on owners is
-- enforced in the server action; RLS restricts owners to their
-- own open rows (chronic + safe approximation).
-- =============================================================
alter table public.commitments enable row level security;
alter table public.commitments force row level security;

create policy commitments_select on public.commitments
for select to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.company_id is not null and ap.company_id = public.commitments.company_id)
  )
);

-- Owner may insert commitments for themselves.
-- Admins may insert commitments for anyone in the company.
create policy commitments_insert_owner on public.commitments
for insert to authenticated
with check (
  public.commitments.owner_id = auth.uid()
  and exists (
    select 1 from public.auth_profile() ap
    where ap.company_id = public.commitments.company_id
  )
);

create policy commitments_insert_admin on public.commitments
for insert to authenticated
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.commitments.company_id)
  )
);

-- Owner updates own row.
create policy commitments_update_owner on public.commitments
for update to authenticated
using (
  public.commitments.owner_id = auth.uid()
  and exists (
    select 1 from public.auth_profile() ap
    where ap.company_id = public.commitments.company_id
  )
)
with check (
  public.commitments.owner_id = auth.uid()
);

create policy commitments_update_admin on public.commitments
for update to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.commitments.company_id)
  )
)
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.commitments.company_id)
  )
);

-- Delete: owner may delete their own row while status is still 'open'.
create policy commitments_delete_owner on public.commitments
for delete to authenticated
using (
  public.commitments.owner_id = auth.uid()
  and public.commitments.status = 'open'
);

create policy commitments_delete_admin on public.commitments
for delete to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'company_admin' and ap.company_id = public.commitments.company_id)
  )
);
