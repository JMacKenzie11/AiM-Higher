-- 0328: a company's weekly recap video, set by an AI app.
--
-- Jason, 2026-11-20. When a team meeting's analysis is ready, the
-- meeting ready webhook (#627) tells a Grok Bot, which builds a 9:16
-- recap video from the company's data, posts it to Vimeo, and hands
-- the link back here through the MCP tool set_recap_video. The newest
-- link is the one /welcome shows. Every link is kept, so the history
-- of a company's recaps is never lost to a replacement.
--
-- 1. recap_videos: one row per link handed back. Read by anyone who
--    can read the company's issues (its own people, its admins, a
--    system admin). No insert, update or delete rule: a row arrives
--    only through the function below, and nothing changes or removes
--    one.
-- 2. assistant_set_recap_video(): the one way in. It checks who is
--    asking (a system admin, the company's own company admin, or a
--    content admin for it: an assigned AiMS Coach, or a portfolio admin
--    a system admin switched on as its admin), that the link is a
--    Vimeo video, and that a named meeting is one of this company's
--    team meetings.
-- 3. The gate: the function on an AI app's menu. The table itself
--    stays closed to an AI app (assistant_refused, given at birth by
--    0270's event trigger).
--
-- Harness: "recap video · an admin sets it, a member cannot", red
-- before 0328: the function does not exist.

-- ---- 1. The table -------------------------------------------------------

create table if not exists public.recap_videos (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  video_url text not null check (char_length(video_url) <= 500),
  vimeo_id text not null check (vimeo_id ~ '^[0-9]{3,15}$'),
  -- The privacy hash of an unlisted video (vimeo.com/<id>/<hash>, or
  -- ?h=<hash> on a player link). Null for a public one.
  vimeo_hash text check (vimeo_hash is null or vimeo_hash ~ '^[0-9a-f]{4,32}$'),
  meeting_id uuid references public.meetings(id) on delete set null,
  added_by uuid references public.profiles(id) on delete set null,
  -- The AI app that handed the link back (the token's client_id), when
  -- it came through one.
  added_via text,
  created_at timestamptz not null default now()
);

comment on table public.recap_videos is
  'A company''s weekly recap videos (Vimeo), newest first is the one /welcome shows. Written only by assistant_set_recap_video() (0328).';

create index if not exists recap_videos_company_newest
  on public.recap_videos (company_id, created_at desc);

alter table public.recap_videos enable row level security;

-- Roles: read only. system_admin; anyone whose own company it is; and
-- admin_company_ids() (assigned AiMS Coaches and portfolio admins), as
-- issues_select (0323).
drop policy if exists recap_videos_select on public.recap_videos;
create policy recap_videos_select on public.recap_videos
for select to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or ((select public.auth_company_id()) is not null and (select public.auth_company_id()) = company_id)
  or company_id = any ((select public.admin_company_ids())::uuid[])
);

-- No insert, update or delete policy. Roles: none directly; rows arrive
-- through assistant_set_recap_video() only.

-- ---- 2. Setting a company's recap video ---------------------------------

-- Roles: system_admin; company_admin of this company; is_content_admin_for()
-- this company (an assigned aims_guide, or a portfolio_admin switched on as
-- its company admin, 0245). Nobody else, whatever the caller came
-- through. SECURITY DEFINER because the table has no insert rule; the
-- check above is the rule.
create or replace function public.assistant_set_recap_video(
  p_company_id uuid,
  p_video_url text,
  p_meeting_id uuid default null
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
  v_row public.recap_videos;
begin
  if not (
    coalesce((select public.auth_role()), '') = 'system_admin'
    or (coalesce((select public.auth_role()), '') = 'company_admin'
        and (select public.auth_company_id()) = p_company_id)
    or public.is_content_admin_for(p_company_id)
  ) then
    raise exception 'recap_video_not_allowed' using errcode = '42501',
      hint = 'Only a system admin or an admin of this company can set its recap video.';
  end if;

  if not exists (select 1 from public.companies c where c.id = p_company_id) then
    raise exception 'recap_video_company_unknown' using errcode = 'P0002';
  end if;

  -- A Vimeo video and nothing else:
  --   https://vimeo.com/<id>, https://vimeo.com/<id>/<hash>
  --   https://player.vimeo.com/video/<id>, with ?h=<hash> when unlisted
  if char_length(v_url) > 500 then
    raise exception 'recap_video_url: too long' using errcode = '22023';
  end if;
  v_match := regexp_match(v_url, '^https://(?:www\.)?vimeo\.com/([0-9]{3,15})(?:/([0-9a-f]{4,32}))?/?(?:[?#].*)?$');
  if v_match is not null then
    v_id := v_match[1];
    v_hash := v_match[2];
  else
    v_match := regexp_match(v_url, '^https://player\.vimeo\.com/video/([0-9]{3,15})/?(?:[?#].*)?$');
    if v_match is null then
      raise exception 'recap_video_url: % is not a Vimeo video link', left(v_url, 120) using errcode = '22023',
        hint = 'Use the video''s Vimeo link, such as https://vimeo.com/123456789.';
    end if;
    v_id := v_match[1];
    v_hash := (regexp_match(v_url, '[?&]h=([0-9a-f]{4,32})(?:&|#|$)'))[1];
  end if;

  if p_meeting_id is not null and not exists (
    select 1 from public.meetings m
     where m.id = p_meeting_id and m.company_id = p_company_id and m.kind = 'team'
  ) then
    raise exception 'recap_video_meeting: not one of this company''s team meetings' using errcode = '22023';
  end if;

  insert into public.recap_videos (company_id, video_url, vimeo_id, vimeo_hash, meeting_id, added_by, added_via)
  values (
    p_company_id, v_url, v_id, v_hash, p_meeting_id, auth.uid(),
    nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'client_id', '')
  )
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'company_id', v_row.company_id,
    'vimeo_id', v_row.vimeo_id,
    'vimeo_hash', v_row.vimeo_hash,
    'meeting_id', v_row.meeting_id,
    'created_at', v_row.created_at
  );
end;
$$;

comment on function public.assistant_set_recap_video(uuid, text, uuid) is
  'Saves a Vimeo link as a company''s newest recap video. A system admin, the company''s company admin, or a content admin for it (0328).';

revoke all on function public.assistant_set_recap_video(uuid, text, uuid) from public, anon;
grant execute on function public.assistant_set_recap_video(uuid, text, uuid) to authenticated;

-- ---- 3. The gate ------------------------------------------------------

-- assistant_request_gate, from 0327, with assistant_set_recap_video
-- added to the menu. Nothing else changes.
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
