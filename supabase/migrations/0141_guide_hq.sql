-- =============================================================
-- Migration 0141: Guide HQ
--
-- Two additions to support the /hq surface:
--
-- 1) session_briefs — append-only per-generation record of the
--    "Prepare for {company}" brief a guide (or sysadmin) runs
--    before a coaching session. Each generation writes a new row
--    so history is preserved and regenerations don't overwrite.
--
-- 2) commitments SELECT — additive policy so a caller can always
--    see commitments they own, regardless of company scope. Lets
--    a guide's own commitments (made across many client companies)
--    surface on their Guide HQ "My commitments" section without
--    any special routing. Harmless for team_members since their
--    own commitments already live in their single company.
--
-- Note on guide assignments: no DB constraint change is required
-- to allow system_admin profiles into guide_assignments. The FK
-- points at profiles(id) without a role check; the "who is
-- assignable" filter lives in the app layer (guides-service +
-- picker). Sysadmin assignments are caseload markers only —
-- they never grant new access, and unassigning a sysadmin never
-- reduces access (their role-based cross-tenant policies stand).
-- =============================================================

-- ---- session_briefs -----------------------------------------
create table if not exists public.session_briefs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  generated_by uuid not null references public.profiles(id) on delete cascade,
  content_markdown text not null,
  based_on_meeting_id uuid references public.meetings(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists session_briefs_company_created_idx
  on public.session_briefs (company_id, created_at desc);

create index if not exists session_briefs_generated_by_idx
  on public.session_briefs (generated_by);

alter table public.session_briefs enable row level security;
alter table public.session_briefs force row level security;

-- SELECT: sysadmin sees all briefs. Everyone else sees only
-- briefs THEY generated AND only for companies where they hold
-- a guide assignment. (Guides can't peek at another guide's
-- briefs, even for the same company.)
drop policy if exists session_briefs_select on public.session_briefs;
create policy session_briefs_select on public.session_briefs
for select to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
  )
  or (
    public.session_briefs.generated_by = auth.uid()
    and public.is_guide_for(public.session_briefs.company_id)
  )
);

-- INSERT: caller must be inserting a row they generated. Sysadmin
-- may insert against any company (their cross-tenant access is
-- unrestricted). Non-sysadmin must hold a guide assignment for
-- the target company.
drop policy if exists session_briefs_insert on public.session_briefs;
create policy session_briefs_insert on public.session_briefs
for insert to authenticated
with check (
  public.session_briefs.generated_by = auth.uid()
  and (
    exists (
      select 1 from public.auth_profile() ap
      where ap.role = 'system_admin'
    )
    or public.is_guide_for(public.session_briefs.company_id)
  )
);

-- No UPDATE / DELETE policies: briefs are append-only. Rows
-- disappear only via the cascade when a company or the author's
-- profile is deleted.

-- ---- commitments SELECT: owner visibility -------------------
-- Supplementary policy: a caller can always see commitments they
-- own, regardless of whether they hold company access. Additive
-- alongside commitments_select (company/sysadmin) and
-- commitments_select_guide (guide-for-company).
drop policy if exists commitments_select_owner on public.commitments;
create policy commitments_select_owner on public.commitments
for select to authenticated
using (public.commitments.owner_id = auth.uid());
