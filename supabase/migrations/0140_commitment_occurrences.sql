-- =============================================================
-- Migration 0140 — commitment_occurrences (per-week resolutions
-- for ongoing commitments)
--
-- Ongoing commitments (commitments.is_ongoing = true) always
-- carry a current due_date. Resolving one records the resolution
-- for that WEEK in this table and rolls the commitments row's
-- due_date forward to the same weekday next week. The commitments
-- row itself never leaves 'open' status while the cycle is active
-- — one row, many occurrences.
--
-- Follow-Through math iterates BOTH tables: non-ongoing resolved
-- commitments contribute one entry each, ongoing rows contribute
-- one entry per occurrence. Kept-on-time / kept-late / missed
-- semantics are identical.
--
-- Unique (commitment_id, week_ending) keeps double-resolves for
-- the same week idempotent — a re-click on an already-resolved
-- occurrence updates in place rather than piling on duplicate
-- rows.
--
-- No missed_needs_reason CHECK here: same rationale as 0139, the
-- action layer decides based on the resolver's role.
-- =============================================================

create table public.commitment_occurrences (
  id uuid primary key default gen_random_uuid(),
  commitment_id uuid not null
    references public.commitments(id) on delete cascade,
  week_ending date not null,
  status text not null
    check (status in ('kept_on_time', 'kept_late', 'missed')),
  missed_reason text,
  resolved_at timestamptz not null default now(),
  resolved_by_profile_id uuid
    references public.profiles(id) on delete set null,
  resolved_by_role text
    check (resolved_by_role is null or resolved_by_role in ('owner','admin','guide')),
  created_at timestamptz not null default now(),
  constraint commitment_occurrences_unique_week
    unique (commitment_id, week_ending)
);

create index commitment_occurrences_commitment_idx
  on public.commitment_occurrences (commitment_id, week_ending);

-- ---- RLS ----------------------------------------------------
-- Mirror the parent commitments policies. Every check joins back
-- through the parent commitment so we don't duplicate company_id
-- on the occurrence rows themselves. Guides get admin-equivalent
-- access via is_guide_for() on the parent's company.

alter table public.commitment_occurrences enable row level security;
alter table public.commitment_occurrences force row level security;

create policy commitment_occurrences_select
on public.commitment_occurrences
for select to authenticated
using (
  exists (
    select 1
    from public.commitments c, public.auth_profile() ap
    where c.id = public.commitment_occurrences.commitment_id
      and (
        ap.role = 'system_admin'
        or (ap.company_id is not null and ap.company_id = c.company_id)
        or public.is_guide_for(c.company_id)
      )
  )
);

-- Owner-scoped write (insert / update / delete on their own
-- commitment's occurrences).
create policy commitment_occurrences_write_owner
on public.commitment_occurrences
for all to authenticated
using (
  exists (
    select 1
    from public.commitments c
    where c.id = public.commitment_occurrences.commitment_id
      and c.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.commitments c
    where c.id = public.commitment_occurrences.commitment_id
      and c.owner_id = auth.uid()
  )
);

-- Admin (system_admin, company_admin scoped, or guide scoped)
-- can write on any of the company's commitments' occurrences.
create policy commitment_occurrences_write_admin
on public.commitment_occurrences
for all to authenticated
using (
  exists (
    select 1
    from public.commitments c, public.auth_profile() ap
    where c.id = public.commitment_occurrences.commitment_id
      and (
        ap.role = 'system_admin'
        or (ap.role = 'company_admin' and ap.company_id = c.company_id)
        or public.is_guide_for(c.company_id)
      )
  )
)
with check (
  exists (
    select 1
    from public.commitments c, public.auth_profile() ap
    where c.id = public.commitment_occurrences.commitment_id
      and (
        ap.role = 'system_admin'
        or (ap.role = 'company_admin' and ap.company_id = c.company_id)
        or public.is_guide_for(c.company_id)
      )
  )
);
