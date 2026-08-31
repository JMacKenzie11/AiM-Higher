-- =============================================================
-- Migration 0154: relax the coaching-share sharee check so a
-- system_admin with a guide_assignments caseload also qualifies.
--
-- 0153 gated the "assigned" branch on `role = 'aims_guide'`, but
-- guide_assignments is also used by sysadmins who carry a
-- coaching caseload (see AssignSysadminForm on /admin/companies).
-- The GuidesPanel treats both role paths uniformly; the coach
-- share layer should too.
--
-- Simplest fix: any profile with a matching guide_assignments row
-- counts as in-company for share purposes, regardless of role.
-- `role` no longer factors into the decision.
-- =============================================================

create or replace function public.profile_is_in_company(
  candidate_profile_id uuid,
  target_company_id uuid
)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = candidate_profile_id
      and (
        p.company_id = target_company_id
        or exists (
          select 1
          from public.guide_assignments ga
          where ga.guide_id = p.id
            and ga.company_id = target_company_id
        )
      )
  );
$$;

-- No policy or trigger changes needed — both already route through
-- the helper (0153), so the new definition takes effect immediately.
