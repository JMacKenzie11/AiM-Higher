-- 0327: AI apps list a company's meetings, and read one in full.
--
-- Jason, 2026-11-18. An AI app that builds a weekly client video needs
-- each meeting's date and whether its analysis finished, and, for the
-- coach, the transcript with speaker names so quotes can be credited.
-- This partly reverses 0270's "never the transcript": only an AiMS
-- Coach assigned to the company, or a system admin, gets the
-- transcript, the speaker names and the facilitation review. Everyone
-- else gets what meeting_summaries already gave them. Coaching calls
-- never, for anyone (0326).
--
-- 1. meeting_analyses.speaker_map: who each transcript label was, as
--    the analyzer resolved it (speakers.ts). It was worked out on every
--    run and thrown away. Written by the analyzer from now on; null on
--    older analyses until they are re-run.
-- 2. assistant_meetings(): the list. Team meetings only, by date range
--    and "since", with whether each analysis is ready (complete and not
--    cut off).
-- 3. assistant_meeting_full(): one meeting. Summary, attendance and
--    analysis state for anyone who can read the meeting; transcript,
--    speaker map, review and scores only for the coach or a system
--    admin (null otherwise).
-- 4. meeting_attendance: readable by an assistant inside the meeting
--    functions only (as meetings are), never written.
-- 5. assistant_company_people(): a company's people with their
--    sign-in emails, for the people who see those emails in the app
--    (profile_email, 0253). Jason, 2026-11-18.
-- 6. The gate: the three functions on the menu.
--
-- Both functions are SECURITY INVOKER: they read as the caller, so the
-- meetings, meeting_analyses and meeting_attendance read rules decide
-- what comes back, exactly as in the app. They open the assistant's
-- restrictive rule on those tables for their own read only, as
-- assistant_meeting_summaries() does (0270).
--
-- Harness: "assistant meetings · the coach reads the transcript",
-- red before 0327.

-- ---- 1. The speaker map ------------------------------------------------

alter table public.meeting_analyses add column if not exists speaker_map jsonb;

comment on column public.meeting_analyses.speaker_map is
  'Who each transcript label was, as the analyzer resolved it: [{label, name, confidence}]. Null on analyses written before 0327.';

-- ---- 2. The list ------------------------------------------------------

-- Roles: read only, as the caller. Any role the gate admits; the
-- meetings read rule decides which meetings.
create or replace function public.assistant_meetings(
  p_company_id uuid,
  p_from date default null,
  p_to date default null,
  p_since timestamptz default null,
  p_limit integer default 20
)
returns table (
  meeting_id uuid,
  meeting_title text,
  held_at timestamptz,
  status text,
  analysed_at timestamptz,
  truncated boolean,
  analysis_ready boolean
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  perform set_config('aims.assistant_scope', 'meeting_summaries', true);
  return query
    select m.id, m.meeting_title, m.created_at, m.status,
           a.created_at,
           coalesce(a.truncated, false),
           (m.status = 'complete' and a.id is not null and not coalesce(a.truncated, false))
      from public.meetings m
      left join public.meeting_analyses a on a.meeting_id = m.id
     where m.company_id = p_company_id
       and m.kind = 'team'
       and not (m.status = 'failed' and m.error = 'dismissed')
       and (p_from is null or m.created_at >= p_from::timestamptz)
       and (p_to is null or m.created_at < (p_to + 1)::timestamptz)
       and (p_since is null or m.created_at > p_since or a.created_at > p_since)
     order by m.created_at desc
     limit least(greatest(coalesce(p_limit, 20), 1), 50);
  perform set_config('aims.assistant_scope', '', true);
exception when others then
  perform set_config('aims.assistant_scope', '', true);
  raise;
end;
$$;

comment on function public.assistant_meetings(uuid, date, date, timestamptz, integer) is
  'An AI app''s list of a company''s team meetings: date, status and whether the analysis is ready, read as the caller (0327).';

revoke all on function public.assistant_meetings(uuid, date, date, timestamptz, integer) from public;
grant execute on function public.assistant_meetings(uuid, date, date, timestamptz, integer) to authenticated;

-- ---- 3. One meeting ----------------------------------------------------

-- Roles: read only, as the caller. The transcript, speaker map, review
-- and scores only for a system_admin or an aims_guide assigned to the
-- company (guide_assignments); null for everyone else. Not
-- is_guide_for(), which admits portfolio admins and company admins.
create or replace function public.assistant_meeting_full(
  p_company_id uuid,
  p_meeting_id uuid
)
returns table (
  meeting_id uuid,
  meeting_title text,
  held_at timestamptz,
  status text,
  analysed_at timestamptz,
  truncated boolean,
  analysis_ready boolean,
  summary text,
  extracted_commitments jsonb,
  week_ending date,
  attendees jsonb,
  full_access boolean,
  transcript text,
  speaker_map jsonb,
  facilitation_review jsonb,
  scores jsonb
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_full boolean;
begin
  v_full := (select public.auth_role()) = 'system_admin'
    or ((select public.auth_role()) = 'aims_guide'
        and exists (select 1 from public.guide_assignments g
                     where g.guide_id = (select auth.uid()) and g.company_id = p_company_id));
  perform set_config('aims.assistant_scope', 'meeting_summaries', true);
  return query
    select m.id, m.meeting_title, m.created_at, m.status,
           a.created_at,
           coalesce(a.truncated, false),
           (m.status = 'complete' and a.id is not null and not coalesce(a.truncated, false)),
           a.analysis_markdown,
           a.commitments_json,
           public.friday_of((m.created_at at time zone c.timezone)::date),
           (select coalesce(jsonb_agg(p.full_name order by p.full_name), '[]'::jsonb)
              from public.meeting_attendance t
              join public.profiles p on p.id = t.profile_id
             where t.company_id = m.company_id
               and t.week_ending = public.friday_of((m.created_at at time zone c.timezone)::date)),
           v_full,
           case when v_full then m.transcript_text end,
           case when v_full then a.speaker_map end,
           case when v_full then a.facilitation_review_json end,
           case when v_full then jsonb_build_object(
             'overall', a.score_overall,
             'positive_framing', a.score_positive_framing,
             'accountability', a.score_accountability,
             'rhythm', a.score_rhythm,
             'alignment', a.score_alignment,
             'agenda_sections_out_of_5', a.score_agenda) end
      from public.meetings m
      join public.companies c on c.id = m.company_id
      left join public.meeting_analyses a on a.meeting_id = m.id
     where m.company_id = p_company_id
       and m.id = p_meeting_id
       and m.kind = 'team';
  perform set_config('aims.assistant_scope', '', true);
exception when others then
  perform set_config('aims.assistant_scope', '', true);
  raise;
end;
$$;

comment on function public.assistant_meeting_full(uuid, uuid) is
  'An AI app''s view of one team meeting, read as the caller. Transcript, speaker map, review and scores only for a system admin or the company''s assigned AiMS Coach (0327).';

revoke all on function public.assistant_meeting_full(uuid, uuid) from public;
grant execute on function public.assistant_meeting_full(uuid, uuid) to authenticated;

-- ---- 4. Attendance, inside the functions only --------------------------

drop policy if exists assistant_refused on public.meeting_attendance;

-- Roles: none added. Restrictive: an assistant reads attendance only
-- inside the meeting functions above; the table's own rules still
-- decide which rows.
drop policy if exists assistant_summaries_only on public.meeting_attendance;
create policy assistant_summaries_only on public.meeting_attendance
as restrictive for select to authenticated
using (not (select public.is_assistant())
       or current_setting('aims.assistant_scope', true) = 'meeting_summaries');

-- Roles: none. An assistant never adds, changes or removes attendance.
drop policy if exists assistant_no_insert on public.meeting_attendance;
create policy assistant_no_insert on public.meeting_attendance
as restrictive for insert to authenticated
with check (not (select public.is_assistant()));
drop policy if exists assistant_no_update on public.meeting_attendance;
create policy assistant_no_update on public.meeting_attendance
as restrictive for update to authenticated
using (not (select public.is_assistant())) with check (not (select public.is_assistant()));
drop policy if exists assistant_no_delete on public.meeting_attendance;
create policy assistant_no_delete on public.meeting_attendance
as restrictive for delete to authenticated
using (not (select public.is_assistant()));

drop policy if exists assistant_through_route on public.meeting_attendance;
create policy assistant_through_route on public.meeting_attendance
as restrictive for all to authenticated
using (not (select public.is_assistant()) or (select public.assistant_through_route()))
with check (not (select public.is_assistant()) or (select public.assistant_through_route()));

-- ---- 5. A company's people, with emails ------------------------------

-- Roles: read only, as the caller. The profiles read rule decides who
-- is listed; profile_email() (0253) decides each email, null where the
-- caller could not see it in the app (the person, anyone in their
-- company, the assigned AiMS Coach, a portfolio admin, a system admin).
create or replace function public.assistant_company_people(p_company_id uuid)
returns table (
  profile_id uuid,
  full_name text,
  job_title text,
  role text,
  status text,
  email text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.id, p.full_name, p.position, p.role::text, p.status::text, public.profile_email(p.id)
    from public.profiles p
   where p.company_id = p_company_id
     and p.status in ('active', 'pending')
   order by p.full_name;
$$;

comment on function public.assistant_company_people(uuid) is
  'An AI app''s list of a company''s people with sign-in emails, read as the caller; each email as profile_email() allows it (0327).';

revoke all on function public.assistant_company_people(uuid) from public;
grant execute on function public.assistant_company_people(uuid) to authenticated;

-- ---- 6. The gate --------------------------------------------------------

-- assistant_request_gate, from 0321, with the two meeting functions
-- and assistant_company_people added to the menu. Nothing else changes.
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
  if m in ('GET', 'POST') and p in (
       '/rpc/assistant_meeting_summaries', '/rpc/assistant_meetings', '/rpc/assistant_meeting_full',
       '/rpc/assistant_company_people') then
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
