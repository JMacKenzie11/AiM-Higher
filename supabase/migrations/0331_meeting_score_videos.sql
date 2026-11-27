-- 0331: a team meeting's score video, set by an AI app.
--
-- Jason, 2026-11-27. When a team meeting has been scored with the
-- facilitation rubric, the meeting ready webhook (#627) carries the
-- score to a Grok Bot, which builds a short 9:16 video going over it,
-- posts it to Vimeo, and hands the link back here through the MCP tool
-- set_meeting_score_video. The newest link for a meeting is the one its
-- page shows, near the top. Every link is kept.
--
-- A table of its own, not recap_videos with a kind: the Dashboard shows
-- the newest recap_videos row for a company, and a meeting's score
-- video must never take that place, before or after this runs.
--
-- 1. meeting_score_videos: one row per link handed back, always for one
--    of the company's team meetings. Read by the company's people, its
--    admins and a system admin. No insert, update or delete rule: a row
--    arrives only through the function below.
-- 2. assistant_set_meeting_score_video(): the one way in. It checks who
--    is asking (a system admin, the company's own company admin, or a
--    content admin for it: an assigned AiMS Coach, or a portfolio admin
--    a system admin switched on as its admin), that the link is a Vimeo
--    video, and that the meeting is one of this company's team meetings.
-- 3. The gate: the function on an AI app's menu, beside 0328's. The
--    table stays closed to an AI app (assistant_refused, given at birth
--    by 0270's event trigger).
--
-- Harness: "meeting score video · an admin sets it, a member cannot",
-- red before 0331: the function does not exist.

-- ---- 1. The table -------------------------------------------------------

create table if not exists public.meeting_score_videos (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  video_url text not null check (char_length(video_url) <= 500),
  vimeo_id text not null check (vimeo_id ~ '^[0-9]{3,15}$'),
  -- The privacy hash of an unlisted video, as recap_videos (0328).
  vimeo_hash text check (vimeo_hash is null or vimeo_hash ~ '^[0-9a-f]{4,32}$'),
  added_by uuid references public.profiles(id) on delete set null,
  added_via text,
  created_at timestamptz not null default now()
);

comment on table public.meeting_score_videos is
  'A team meeting''s score videos (Vimeo); the newest for a meeting is the one its page shows. Written only by assistant_set_meeting_score_video() (0331).';

create index if not exists meeting_score_videos_meeting_newest
  on public.meeting_score_videos (meeting_id, created_at desc);

alter table public.meeting_score_videos enable row level security;

-- Roles: read only. system_admin; anyone whose own company it is; and
-- admin_company_ids() (assigned AiMS Coaches and portfolio admins), as
-- recap_videos_select (0328).
drop policy if exists meeting_score_videos_select on public.meeting_score_videos;
create policy meeting_score_videos_select on public.meeting_score_videos
for select to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or ((select public.auth_company_id()) is not null and (select public.auth_company_id()) = company_id)
  or company_id = any ((select public.admin_company_ids())::uuid[])
);

-- No insert, update or delete policy. Roles: none directly; rows arrive
-- through assistant_set_meeting_score_video() only.

-- ---- 2. Setting a meeting's score video ---------------------------------

-- Roles that may write through it: system_admin; company_admin of this
-- company; is_content_admin_for(company) (an assigned aims_guide, or a
-- portfolio_admin a system admin switched on as its admin). As 0328.
create or replace function public.assistant_set_meeting_score_video(
  p_company_id uuid,
  p_meeting_id uuid,
  p_video_url text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_url text := btrim(coalesce(p_video_url, ''));
  v_match text[];
  v_id text;
  v_hash text;
  v_row public.meeting_score_videos;
begin
  if not (
    coalesce((select public.auth_role()), '') = 'system_admin'
    or (coalesce((select public.auth_role()), '') = 'company_admin'
        and (select public.auth_company_id()) = p_company_id)
    or public.is_content_admin_for(p_company_id)
  ) then
    raise exception 'meeting_score_video_not_allowed' using errcode = '42501',
      hint = 'Only a system admin or an admin of this company can set a meeting''s score video.';
  end if;
  if not exists (
    select 1 from public.meetings m
     where m.id = p_meeting_id and m.company_id = p_company_id and m.kind = 'team'
  ) then
    raise exception 'meeting_score_video_meeting: not one of this company''s team meetings' using errcode = '22023';
  end if;
  if char_length(v_url) > 500 then
    raise exception 'meeting_score_video_url: too long' using errcode = '22023';
  end if;
  v_match := regexp_match(v_url, '^https://(?:www\.)?vimeo\.com/([0-9]{3,15})(?:/([0-9a-f]{4,32}))?/?(?:[?#].*)?$');
  if v_match is not null then
    v_id := v_match[1];
    v_hash := v_match[2];
  else
    v_match := regexp_match(v_url, '^https://player\.vimeo\.com/video/([0-9]{3,15})/?(?:[?#].*)?$');
    if v_match is null then
      raise exception 'meeting_score_video_url: % is not a Vimeo video link', left(v_url, 120) using errcode = '22023',
        hint = 'Use the video''s Vimeo link, such as https://vimeo.com/123456789.';
    end if;
    v_id := v_match[1];
    v_hash := (regexp_match(v_url, '[?&]h=([0-9a-f]{4,32})(?:&|#|$)'))[1];
  end if;
  insert into public.meeting_score_videos (company_id, meeting_id, video_url, vimeo_id, vimeo_hash, added_by, added_via)
  values (
    p_company_id, p_meeting_id, v_url, v_id, v_hash, auth.uid(),
    nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'client_id', '')
  )
  returning * into v_row;
  return jsonb_build_object(
    'id', v_row.id,
    'company_id', v_row.company_id,
    'meeting_id', v_row.meeting_id,
    'vimeo_id', v_row.vimeo_id,
    'vimeo_hash', v_row.vimeo_hash,
    'created_at', v_row.created_at
  );
end;
$$;

comment on function public.assistant_set_meeting_score_video(uuid, uuid, text) is
  'Saves a Vimeo link as a team meeting''s newest score video. A system admin, the company''s company admin, or a content admin for it (0331).';

revoke all on function public.assistant_set_meeting_score_video(uuid, uuid, text) from public, anon;
grant execute on function public.assistant_set_meeting_score_video(uuid, uuid, text) to authenticated;

-- ---- 3. The gate: 0328's, with the function on the menu -----------------

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
  -- A company's recap video (0328). The function checks who may.
  if m = 'POST' and p = '/rpc/assistant_set_recap_video' then
    return;
  end if;
  -- A team meeting's score video (0331). The function checks who may.
  if m = 'POST' and p = '/rpc/assistant_set_meeting_score_video' then
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
