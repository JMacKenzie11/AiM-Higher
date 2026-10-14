-- 0279: a company's own switch for outside assistants, off by default.
--
-- WHY. Jason, 2026-10-13 (decision 8): the company switch is off until
-- a company admin turns it on, because switching it on sends company
-- data to an outside service. Phase 4, before any client gets access.
--
-- WHAT. companies.assistants_enabled, false for every company, existing
-- and new. While it is false, the MCP route refuses every request that
-- names the company (lib/mcp, runTool), for everyone, system admins
-- included: no company's data reaches an outside assistant until that
-- company has said yes. Every change is recorded by the existing
-- companies_log_settings_changes trigger (0189), which logs any column.
--
-- WHO MAY FLIP IT. A system admin (unrestricted on companies since
-- 0004), the company's company_admin, and an assigned aims_guide (who
-- is a company admin on their companies). This is a widening for the
-- last two: companies_restrict_admin_columns allowed them only
-- industry and the champion seat (0176, 0235). It is rebuilt from the
-- LIVE definition (pg_get_functiondef on the dev clone, which matches
-- 0235) with one column added to their list. A portfolio_admin is not
-- given it: their list is the container's five columns, unchanged.
-- Harness probe: company assistants switch · who may flip it.

alter table public.companies
  add column if not exists assistants_enabled boolean not null default false;

comment on column public.companies.assistants_enabled is
  'Outside assistants (MCP) may read and add for this company only while true. Off by default; a company admin, assigned guide or system admin switches it (0279).';

-- Roles: system_admin (any column); portfolio_admin (name, timezone,
-- industry, status, sort_order); company_admin and aims_guide (industry,
-- the AiMS champion seat, and since 0279 assistants_enabled). Applies
-- on top of companies_update, which decides which company each may
-- update at all.
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

  -- The container role: five named columns, everything else refused.
  -- Unchanged from 0203 and 0235, and still not assistants_enabled.
  if caller_role is not distinct from 'portfolio_admin' then
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
