-- 0284: outside assistants on by default, for every role but portfolio
-- admins.
--
-- WHY. Jason, 2026-10-14 (decision change): outside assistants are on by
-- default, everywhere. A company starts with them switched on, existing
-- companies are switched on here, and a company admin can still switch
-- them off. They are open to every role except portfolio admins, who
-- stay off for now.
--
-- WHAT.
--   1. companies.assistants_enabled defaults to true.
--   2. Every existing company is switched on, recorded in the settings
--      history with no person and the note "switched on by AiMS default".
--      company_settings_events gains a `note`, which the history trigger
--      fills from the session setting aims.settings_note when one is set
--      (only this migration sets it).
--   3. The database gate refuses an assistant token for a portfolio
--      admin, beside the same rule in the MCP route, the consent page and
--      the profile (lib/mcp/switch.ts, mcpOpenTo).

alter table public.companies alter column assistants_enabled set default true;

alter table public.company_settings_events add column if not exists note text
  check (note is null or char_length(note) <= 200);

comment on column public.company_settings_events.note is
  'Why a change was made when no person made it, such as "switched on by AiMS default" (0284).';

-- Roles: none. The settings history trigger from 0189, unchanged except
-- that it records aims.settings_note when one is set.
create or replace function public.log_company_settings_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  before_row jsonb;
  after_row jsonb;
  changed_field text;
  actor uuid;
  why text := nullif(current_setting('aims.settings_note', true), '');
begin
  before_row := to_jsonb(old) - 'updated_at';
  after_row := to_jsonb(new) - 'updated_at';

  if before_row is not distinct from after_row then
    return null;
  end if;

  actor := auth.uid();

  for changed_field in
    select key from jsonb_each(before_row)
    union
    select key from jsonb_each(after_row)
  loop
    if before_row -> changed_field is distinct from after_row -> changed_field then
      insert into public.company_settings_events
        (company_id, field, old_value, new_value, actor_id, note)
      values (
        new.id,
        changed_field,
        before_row ->> changed_field,
        after_row ->> changed_field,
        actor,
        why
      );
    end if;
  end loop;

  return null;
end;
$$;

-- In a block, so the migration returns no rows of its own (the RLS
-- harness reads the first result back) and the note is cleared before
-- anything else runs.
do $$
begin
  perform set_config('aims.settings_note', 'switched on by AiMS default', true);
  update public.companies
     set assistants_enabled = true
   where not assistants_enabled
     and deleted_at is null;
  perform set_config('aims.settings_note', '', true);
end $$;

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
  -- Every role but portfolio_admin (0284; Jason, 2026-10-14).
  if (select public.auth_role()) = 'portfolio_admin' then
    raise exception 'assistant_role_not_open'
      using errcode = '42501',
            hint = 'AI apps aren''t open to portfolio admins yet.';
  end if;
  if not public.assistant_through_route() then
    raise exception 'assistant_outside_route'
      using errcode = '42501',
            hint = 'An outside assistant reaches AiMS only through its MCP server.';
  end if;
  m := upper(coalesce(current_setting('request.method', true), ''));
  p := rtrim(coalesce(current_setting('request.path', true), ''), '/');
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
  raise exception 'assistant_not_on_menu: % %', m, p
    using errcode = '42501',
          hint = 'An outside assistant may only use the AiMS menu.';
end;
$$;


notify pgrst, 'reload config';
