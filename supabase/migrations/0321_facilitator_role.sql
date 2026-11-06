-- 0321: the Facilitator, a company role between team member and
-- company admin.
--
-- WHY. Jason, 2026-11-06. Someone runs a company's weekly rhythm
-- without administering the company: they work everyone's
-- commitments and keep the Critical Success Factors current, and
-- people stay with the company's admins.
--
-- WHAT A FACILITATOR HOLDS, in their own company only:
--   commitments              create for anyone, edit, resolve,
--                            reschedule, reassign, delete
--   commitment_occurrences   write, as for the commitment itself
--   success_measures         add, edit, archive, delete, in any function
--   success_measure_entries  record, correct, remove a value, any week
--   success_measure_targets  through the success_measures update, as
--                            for everyone (no write policy of its own)
-- Everything else is a team member's: they read the company's data
-- (auth_company_id(), whatever the role) and write their own work.
-- They cannot add, edit, deactivate or remove people: no profiles
-- write policy names the role, and the ones below only let admins
-- manage a facilitator as they manage a team member.
--
-- WHO MAY GRANT IT: whoever may grant team_member today. A company
-- admin, an assigned guide, a portfolio admin (0192's closed list
-- already lets it invite company roles) and a system admin.
--
-- Harness: "facilitator · team work, not people", red before 0321.

-- ---- The role ------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('system_admin', 'company_admin', 'facilitator', 'team_member',
                  'aims_guide', 'portfolio_admin', 'diagnostic_client', 'bot_account'));

-- is_facilitator_for(company): the caller is a facilitator and the
-- company is their own. Reads only the caller's own row, through the
-- same definer helpers every policy uses.
create or replace function public.is_facilitator_for(target_company_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((select public.auth_role()) = 'facilitator', false)
     and target_company_id is not null
     and (select public.auth_company_id()) = target_company_id
$$;
revoke all on function public.is_facilitator_for(uuid) from public;
grant execute on function public.is_facilitator_for(uuid) to authenticated;

-- ---- Commitments ---------------------------------------------------
-- Each admits: a facilitator in the row's company. Beside the owner,
-- admin and guide rules, which are unchanged.
create policy commitments_insert_facilitator on public.commitments
for insert to authenticated
with check (public.is_facilitator_for(company_id));

create policy commitments_update_facilitator on public.commitments
for update to authenticated
using (public.is_facilitator_for(company_id))
with check (public.is_facilitator_for(company_id));

create policy commitments_delete_facilitator on public.commitments
for delete to authenticated
using (public.is_facilitator_for(company_id));

-- Admits: a facilitator in the commitment's company.
create policy commitment_occurrences_write_facilitator on public.commitment_occurrences
for all to authenticated
using (exists (
  select 1 from public.commitments c
   where c.id = commitment_occurrences.commitment_id
     and public.is_facilitator_for(c.company_id)))
with check (exists (
  select 1 from public.commitments c
   where c.id = commitment_occurrences.commitment_id
     and public.is_facilitator_for(c.company_id)));

-- ---- Critical Success Factors ---------------------------------------
-- Each admits: a facilitator in the function's company. Beside the
-- admin, guide and Lead rules, which are unchanged.
create policy success_measures_insert_facilitator on public.success_measures
for insert to authenticated
with check (exists (
  select 1 from public.functions f
   where f.id = success_measures.function_id
     and public.is_facilitator_for(f.company_id)));

create policy success_measures_update_facilitator on public.success_measures
for update to authenticated
using (exists (
  select 1 from public.functions f
   where f.id = success_measures.function_id
     and public.is_facilitator_for(f.company_id)))
with check (exists (
  select 1 from public.functions f
   where f.id = success_measures.function_id
     and public.is_facilitator_for(f.company_id)));

create policy success_measures_delete_facilitator on public.success_measures
for delete to authenticated
using (exists (
  select 1 from public.functions f
   where f.id = success_measures.function_id
     and public.is_facilitator_for(f.company_id)));

create policy success_measure_entries_insert_facilitator on public.success_measure_entries
for insert to authenticated
with check (exists (
  select 1 from public.success_measures m
    join public.functions f on f.id = m.function_id
   where m.id = success_measure_entries.measure_id
     and public.is_facilitator_for(f.company_id)));

create policy success_measure_entries_update_facilitator on public.success_measure_entries
for update to authenticated
using (exists (
  select 1 from public.success_measures m
    join public.functions f on f.id = m.function_id
   where m.id = success_measure_entries.measure_id
     and public.is_facilitator_for(f.company_id)))
with check (exists (
  select 1 from public.success_measures m
    join public.functions f on f.id = m.function_id
   where m.id = success_measure_entries.measure_id
     and public.is_facilitator_for(f.company_id)));

create policy success_measure_entries_delete_facilitator on public.success_measure_entries
for delete to authenticated
using (exists (
  select 1 from public.success_measures m
    join public.functions f on f.id = m.function_id
   where m.id = success_measure_entries.measure_id
     and public.is_facilitator_for(f.company_id)));

-- ---- People: admins manage a facilitator as they manage a team member
-- The same rules, word for word, with 'facilitator' added to the roles
-- a company admin, an assigned guide or a portfolio admin may create,
-- change and remove. None of them admits a facilitator as the caller.

-- Admits: a system admin; a company admin in their own company, for a
-- company role, never themselves.
alter policy profiles_delete on public.profiles
using (
  ((select public.auth_role()) = 'system_admin')
  or (((select public.auth_role()) = 'company_admin')
      and ((select public.auth_company_id()) is not null)
      and ((select public.auth_company_id()) = company_id)
      and ((select auth.uid()) <> id)
      and (role = any (array['company_admin', 'facilitator', 'team_member'])))
);

-- Admits: an assigned guide, for a company role, never themselves.
alter policy profiles_delete_guide on public.profiles
using (
  (company_id is not null) and public.is_guide_for(company_id) and (id <> auth.uid())
  and (role = any (array['company_admin', 'facilitator', 'team_member']))
);

-- Admits: a system admin; a company admin, a company role in their company.
alter policy profiles_insert on public.profiles
with check (
  ((select public.auth_role()) = 'system_admin')
  or (((select public.auth_role()) = 'company_admin')
      and ((select public.auth_company_id()) is not null)
      and ((select public.auth_company_id()) = company_id)
      and (role = any (array['company_admin', 'facilitator', 'team_member'])))
);

-- Admits: an assigned guide, a company role.
alter policy profiles_insert_guide on public.profiles
with check (
  (company_id is not null) and public.is_guide_for(company_id)
  and (role = any (array['company_admin', 'facilitator', 'team_member']))
);

-- Admits: a portfolio admin, a company role (0192's closed list).
alter policy profiles_insert_portfolio on public.profiles
with check (
  (select public.is_portfolio_admin()) and (company_id is not null)
  and (role = any (array['company_admin', 'facilitator', 'team_member']))
);

-- Admits: a company admin in their company, a company role, never themselves.
alter policy profiles_update_company_admin on public.profiles
using (
  ((select public.auth_role()) = 'company_admin')
  and ((select public.auth_company_id()) is not null)
  and ((select public.auth_company_id()) = company_id)
  and ((select auth.uid()) <> id)
  and (role = any (array['company_admin', 'facilitator', 'team_member']))
)
with check (
  ((select public.auth_role()) = 'company_admin')
  and ((select public.auth_company_id()) is not null)
  and ((select public.auth_company_id()) = company_id)
  and ((select auth.uid()) <> id)
  and (role = any (array['company_admin', 'facilitator', 'team_member']))
);

-- Admits: an assigned guide, a company role, never themselves.
alter policy profiles_update_guide on public.profiles
using (
  (company_id is not null) and public.is_guide_for(company_id) and (id <> auth.uid())
  and (role = any (array['company_admin', 'facilitator', 'team_member']))
)
with check (
  (company_id is not null) and public.is_guide_for(company_id)
  and (role = any (array['company_admin', 'facilitator', 'team_member']))
  and (id <> auth.uid())
);

-- ---- AI apps are open to a facilitator, as to a team member ---------
-- assistant_request_gate, from 0314, with 'facilitator' added to the
-- roles AI apps are open to (lib/mcp/switch.ts, OPEN_ROLES).
create or replace function public.assistant_request_gate()
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  m text;
  p text;
begin
  if not public.is_assistant() then
    return;
  end if;
  if not public.assistant_session_live() then
    raise exception 'assistant_session_ended'
      using errcode = 'PT401',
            hint = 'This assistant''s access was revoked or has expired. Connect it again.';
  end if;
  if not public.assistant_client_trusted(
       nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'client_id') then
    raise exception 'assistant_client_not_approved'
      using errcode = '42501',
            hint = 'This assistant isn''t approved for AiMS.';
  end if;
  -- The roles AI apps are open to (lib/mcp/switch.ts, OPEN_ROLES).
  if coalesce((select public.auth_role()), '') not in ('system_admin', 'company_admin', 'aims_guide', 'facilitator', 'team_member', 'bot_account') then
    raise exception 'assistant_role_not_open'
      using errcode = '42501',
            hint = 'AI apps aren''t open to this account.';
  end if;
  if not public.assistant_through_route() then
    raise exception 'assistant_outside_route'
      using errcode = '42501',
            hint = 'An outside assistant reaches AiMS only through its MCP server.';
  end if;
  m := upper(coalesce(current_setting('request.method', true), ''));
  p := rtrim(coalesce(current_setting('request.path', true), ''), '/');
  -- An automation account (0314) has a menu of its own: its own
  -- profile row (the MCP route checks it is active), a bot's run and
  -- the bot list. Nothing else, whatever the rest of the menu allows.
  if (select public.auth_role()) = 'bot_account' then
    if (m in ('GET', 'HEAD') and p = '/profiles')
       or (m = 'POST' and p = '/rpc/assistant_record_bot_run')
       or (m in ('GET', 'POST') and p = '/rpc/assistant_bots') then
      return;
    end if;
    raise exception 'assistant_not_on_menu: % %', m, p
      using errcode = '42501',
            hint = 'An automation account may only report and list bots.';
  end if;
  if m in ('GET', 'HEAD') and p in (
       '/commitments', '/commitment_occurrences', '/issues',
       '/success_measures', '/success_measure_entries', '/success_measure_targets',
       '/functions', '/function_roles', '/function_decision_rights', '/function_competencies',
       '/companies', '/profiles', '/guide_assignments', '/portfolio_assignments',
       '/quarters', '/strategic_focus_areas', '/annual_goals', '/priorities',
       '/company_foundation', '/foundation_items') then
    return;
  end if;
  if m = 'POST' and p in ('/commitments', '/issues', '/success_measure_entries', '/aimee_handoffs') then
    return;
  end if;
  if m in ('GET', 'POST') and p = '/rpc/assistant_meeting_summaries' then
    return;
  end if;
  if m = 'POST' and p = '/rpc/assistant_record_bot_run' then
    return;
  end if;
  if m in ('GET', 'POST') and p = '/rpc/assistant_bots' then
    return;
  end if;
  raise exception 'assistant_not_on_menu: % %', m, p
    using errcode = '42501',
          hint = 'An outside assistant may only use the AiMS menu.';
end;
$$;

notify pgrst, 'reload config';
