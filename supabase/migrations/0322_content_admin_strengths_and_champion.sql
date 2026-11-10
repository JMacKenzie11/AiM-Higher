-- =============================================================
-- Migration 0322 — a company's content admins edit its people's
-- strengths and set its AiMS champion
--
-- Jason, 2026-11-09: "A portfolio admin who is a company admin should
-- be able to do everything a company admin can do." 0245 made the
-- switch (portfolio_assignments.acts_as_company_admin) and moved 75
-- content write rules onto is_content_admin_for(). Two company admin
-- writes were never on that list, so a switched-on portfolio admin is
-- still refused them, and so is an assigned guide:
--
--   1. user_strengths. 0188's rules admit the subject, a system admin
--      and the subject's company_admin by auth_company_id(), which is
--      null for both cross-company roles. No rule admits either of
--      them, for any verb but the portfolio admin's read.
--
--   2. companies.aims_champion_profile_id. The column guard
--      (companies_restrict_admin_columns, 0279) lets a company admin
--      change industry, the champion and the assistants switch, but
--      sends every portfolio admin down the container branch, which
--      allows name, timezone, industry, status and sort_order only.
--
-- Both now admit is_content_admin_for(company): an assigned aims_guide,
-- or a portfolio admin a system admin switched on as that company's
-- admin. CLAUDE.md, Permissions: that switch is the one route by which
-- portfolio_admin holds a company's admin writes. A portfolio admin
-- who is only assigned is refused, as before.
--
-- Not changed: assistants_enabled stays off the portfolio admin's
-- columns. AI apps are not open to that role (lib/mcp/switch.ts,
-- assistant_request_gate), so the switch would be one it cannot use.
-- =============================================================

-- ---- 1. user_strengths ---------------------------------------------

-- Read: the save deletes and re-inserts, and a delete reaches only the
-- rows the caller can see (E11). A portfolio admin already reads them
-- (user_strengths_select_portfolio); a guide did not.
-- Admits: an assigned aims_guide or a switched-on portfolio admin, for
-- members of that company.
create policy "user_strengths_select_content_admin" on public.user_strengths
  for select to authenticated
  using (exists (
    select 1 from public.profiles p
     where p.id = user_strengths.user_id
       and p.company_id is not null
       and public.is_content_admin_for(p.company_id)
  ));

-- Admits: an assigned aims_guide or a switched-on portfolio admin, for
-- members of that company.
create policy "user_strengths_insert_content_admin" on public.user_strengths
  for insert to authenticated
  with check (exists (
    select 1 from public.profiles p
     where p.id = user_strengths.user_id
       and p.company_id is not null
       and public.is_content_admin_for(p.company_id)
  ));

-- Admits: an assigned aims_guide or a switched-on portfolio admin, for
-- members of that company.
create policy "user_strengths_update_content_admin" on public.user_strengths
  for update to authenticated
  using (exists (
    select 1 from public.profiles p
     where p.id = user_strengths.user_id
       and p.company_id is not null
       and public.is_content_admin_for(p.company_id)
  ))
  with check (exists (
    select 1 from public.profiles p
     where p.id = user_strengths.user_id
       and p.company_id is not null
       and public.is_content_admin_for(p.company_id)
  ));

-- Admits: an assigned aims_guide or a switched-on portfolio admin, for
-- members of that company.
create policy "user_strengths_delete_content_admin" on public.user_strengths
  for delete to authenticated
  using (exists (
    select 1 from public.profiles p
     where p.id = user_strengths.user_id
       and p.company_id is not null
       and public.is_content_admin_for(p.company_id)
  ));

-- ---- 2. the champion -----------------------------------------------

create or replace function public.companies_restrict_admin_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
begin
  caller_role := (select public.auth_role());

  -- The container role: five named columns. Where a system admin has
  -- switched it on as this company's admin (0245), the champion too,
  -- as for the company's own admin (0322). Everything else refused.
  if caller_role is not distinct from 'portfolio_admin' then
    if public.is_content_admin_for(old.id) then
      if (to_jsonb(new) - 'name' - 'timezone' - 'industry' - 'status'
                        - 'sort_order' - 'aims_champion_profile_id' - 'updated_at')
         is distinct from
         (to_jsonb(old) - 'name' - 'timezone' - 'industry' - 'status'
                        - 'sort_order' - 'aims_champion_profile_id' - 'updated_at') then
        raise exception
          'A portfolio_admin may change only name, timezone, industry, status, sort_order and the AiMS champion on a company it administers (attempted on company %)',
          old.id
          using errcode = 'insufficient_privilege';
      end if;
      return new;
    end if;
    if (to_jsonb(new) - 'name' - 'timezone' - 'industry' - 'status'
                      - 'sort_order' - 'updated_at')
       is distinct from
       (to_jsonb(old) - 'name' - 'timezone' - 'industry' - 'status'
                      - 'sort_order' - 'updated_at') then
      raise exception
        'A portfolio_admin may change only name, timezone, industry, status and sort_order on a company (attempted on company %)',
        old.id
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  if caller_role is distinct from 'company_admin'
     and caller_role is distinct from 'aims_guide' then
    return new;
  end if;

  -- 0176, 0235, and the assistants switch (0279). Still a denylist:
  -- a column added tomorrow is refused to these two the day it is
  -- added.
  if (to_jsonb(new) - 'industry' - 'aims_champion_profile_id' - 'assistants_enabled' - 'updated_at')
     is distinct from
     (to_jsonb(old) - 'industry' - 'aims_champion_profile_id' - 'assistants_enabled' - 'updated_at') then
    raise exception
      'Only industry, the AiMS champion and the outside assistants switch may be changed on a company by a % (attempted on company %)',
      caller_role, old.id
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;
