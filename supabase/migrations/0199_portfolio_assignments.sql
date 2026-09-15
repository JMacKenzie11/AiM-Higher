-- Portfolio assignments: company-admin rights for a portfolio admin.
--
-- Step 2 of the sequence in product-spec §1a. Additive and
-- BEHAVIOUR-NEUTRAL: with no rows in the new table, every existing
-- caller resolves exactly as it does today. That property is the
-- whole reason this ships on its own, ahead of the column and the
-- resolver, because the function it extends is not dormant —
-- is_guide_for() carries 17 live assignments across two real guides,
-- and a mistake in it reaches them the moment it deploys.
--
-- What this does NOT do, deliberately:
--   * no home company column, and no touching
--     profiles_portfolio_admin_has_no_company (step 3, and the audit
--     of 2026-09-15 says the constraint stays)
--   * no company_admin delete on guide_assignments. That is decision
--     7 and it CHANGES behaviour immediately against those 17 rows,
--     so it cannot ride in a migration whose claim is that nothing
--     changes. It travels with its surface.

-- ---- portfolio_assignments -----------------------------------
-- Mirrors guide_assignments in shape, because it is the same idea:
-- a row here means this portfolio admin holds company-admin rights
-- in this company.
create table if not exists public.portfolio_assignments (
  portfolio_admin_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (portfolio_admin_id, company_id)
);

create index if not exists portfolio_assignments_company_idx
  on public.portfolio_assignments (company_id);

alter table public.portfolio_assignments enable row level security;
alter table public.portfolio_assignments force row level security;

comment on table public.portfolio_assignments is
  'A portfolio admin holds company-admin rights in these companies. '
  'Self-assignable by design (spec §1a decision 2): the instance IS '
  'the portfolio, and whether they should assign a given company is a '
  'conversation with its owners rather than a rule the software '
  'imposes. What the software owes is that the arrangement is legible.';

-- Read: system_admin sees all; a portfolio admin sees their own rows.
--
-- A company_admin of the target company deliberately sees nothing
-- here yet. Whether they should is the one open question left in
-- §1a, and answering it by accident in the table that created it
-- would be the wrong way round.
create policy portfolio_assignments_select on public.portfolio_assignments
for select to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or ap.uid = public.portfolio_assignments.portfolio_admin_id
  )
);

-- Insert: a system_admin, or a portfolio admin assigning THEMSELVES.
--
-- The self-assignment clause is decision 2, and the `ap.uid =
-- portfolio_admin_id` half of it is what keeps it from being a way to
-- assign somebody else. A portfolio admin granting another portfolio
-- admin access is not a thing this table can express.
create policy portfolio_assignments_insert on public.portfolio_assignments
for insert to authenticated
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'portfolio_admin'
           and ap.uid = public.portfolio_assignments.portfolio_admin_id)
  )
);

-- Delete: the holder, or a system_admin. NOT the company's own admin.
--
-- Decision 5, and the one clause somebody will be tempted to add
-- because it reads as symmetric with every other people-management
-- policy in this schema. It is not symmetric: the portfolio owns the
-- company, and a company admin who could evict the operator could
-- lock the owner out of their own holding. A guide is the opposite
-- case and IS revocable by the company — that is decision 7, and it
-- lives on guide_assignments, not here.
create policy portfolio_assignments_delete on public.portfolio_assignments
for delete to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.role = 'portfolio_admin'
           and ap.uid = public.portfolio_assignments.portfolio_admin_id)
  )
);

-- ---- is_admin_for: the canonical assignment test ---------------
-- True when the caller holds admin-equivalent rights in this company
-- by assignment: an aims_guide through guide_assignments, or a
-- portfolio_admin through portfolio_assignments.
--
-- SECURITY DEFINER for the same reason is_guide_for was: it must not
-- recurse back through the profiles / assignment policies.
create or replace function public.is_admin_for(target_company_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    join public.guide_assignments ga on ga.guide_id = p.id
    where p.id = auth.uid()
      and p.role = 'aims_guide'
      and ga.company_id = target_company_id
  )
  or exists (
    select 1
    from public.profiles p
    join public.portfolio_assignments pa on pa.portfolio_admin_id = p.id
    where p.id = auth.uid()
      and p.role = 'portfolio_admin'
      and pa.company_id = target_company_id
  )
$$;

revoke all on function public.is_admin_for(uuid) from public;
grant execute on function public.is_admin_for(uuid) to authenticated;

-- ---- is_guide_for becomes a wrapper ---------------------------
-- ~117 live policies call this. Redefining the body rather than
-- editing them is the entire reason this change is tractable; the
-- alternative is 117 mirror policies, which is what made 0111
-- expensive.
--
-- The name is now wrong, and is kept anyway. Renaming every call site
-- in the same migration that changes the semantics would mean a diff
-- where nothing is small enough to check. The wrapper is the
-- migration path: new policies call is_admin_for, old ones keep
-- working, and the rename happens when nothing depends on the timing.
create or replace function public.is_guide_for(target_company_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.is_admin_for(target_company_id)
$$;

revoke all on function public.is_guide_for(uuid) from public;
grant execute on function public.is_guide_for(uuid) to authenticated;

comment on function public.is_guide_for(uuid) is
  'DEPRECATED NAME, live behaviour. Thin wrapper over is_admin_for(). '
  'Kept because ~117 policies call it; new policies should call '
  'is_admin_for() directly.';
