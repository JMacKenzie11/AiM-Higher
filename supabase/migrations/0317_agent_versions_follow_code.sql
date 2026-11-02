-- 0317: a version published unchanged from the code follows the code.
--
-- WHY. Jason, 2026-11-02. The Vivid Vision Coach was published in the
-- Agent Hub on 2026-10-27 without a word changed, on production and
-- (pushed) on promiseone. A published version wins over the code, so
-- the five instruction changes merged since (#555 to #559) reached
-- neither: a tester ran the first prompt a week later. Nobody had
-- chosen to keep the old wording; publishing a copy of the code froze
-- it.
--
-- WHAT. agent_versions.follows_code. A version marked with it runs the
-- registry's config at runtime (version-config.ts), so a change to the
-- prompt file reaches it on release. The Hub marks a version when it
-- is published identical to the code in every field the runtime reads
-- (follows-code.ts). A version anybody edited keeps its own text.
--
-- This deliberately relaxes 14c's "a version row is self-contained"
-- for marked rows only: a marked row's config is the code's, as an
-- unpublished agent's always was.
--
-- BACKFILL. Every existing version of a code-defined agent whose
-- prompt matches the prompt file at ANY commit in its history, and
-- whose other fields match the code as it is now, is marked. The
-- hashes are md5 of the trimmed file at each commit, generated from
-- git. Surveyed 2026-11-02: production's and promiseone's Vivid
-- Vision v3 are marked (the #513 prompt, nothing else changed).
-- Production's Prepare a Hard Conversation v3 is NOT: its prompt is
-- the code's, but its token ceiling was set to 8000 in the Hub on
-- 2026-09-23, which is an edit.
--
-- The column write bypasses 0228's "UPDATE granted to nobody" because
-- a migration runs as the owner. That is the one sanctioned way to
-- change a version row, and this is a mark, not the text.
--
-- Also: insert_distributed_agent_version takes v_follows_code, so a
-- pushed version carries its mark (default false, so a caller that
-- does not name it is unchanged).

alter table public.agent_versions
  add column if not exists follows_code boolean not null default false;

comment on column public.agent_versions.follows_code is
  'Published unchanged from the code: runs the registry''s config, so code changes reach it on release. See 0317.';

with code (slug, prompt_md5s, chips, tools, base_prompt_mode, skip_setup, first_turn, scripted_opener, max_tokens) as (
  values
  ('prepare-a-hard-conversation', array[
      'fb0ccc4abf7345f68882eb0b65b21a32',
      '52099f2d555c94b25f5887594788cde6',
      'da626e97c8c400a202f5903df199e155'
    ], '["Someone isn''t following through","Something''s off between us","I need to reset expectations"]'::jsonb, array[]::text[], 'full_coach', false, null, null, null),
  ('navigate-emotionally-charged-conversation', array[
      '242ccffae0364101ef3a00a572622418'
    ], '["Someone on my team gets easily upset","I keep making things worse when they''re stressed","I need to talk to someone who''s already frustrated"]'::jsonb, array[]::text[], 'full_coach', false, null, null, null),
  ('e2e-version-test', array[
      'e465bf12ad51c1d516233bdcbb663c84'
    ], '["Code default opening"]'::jsonb, array[]::text[], 'voice_only', false, null, null, null),
  ('ask-better-questions', array[
      '1386e98fa3bb52bef731ae9cc40236e8',
      '3b3ea4ee1a3c10fc2bbd887350f50306',
      'fcf05ff94220aeaf36f9819f4fbe0f05'
    ], '["I have a conversation to prepare for","I''m stuck on a limiting question","Show me examples for a topic"]'::jsonb, array[]::text[], 'full_coach', false, null, null, null),
  ('functional-chart-builder', array[
      '743723f3e64761470c3fd59f62207629',
      '4236d5b94d759b70cf4ab43bf9039f3f',
      'f298dc39b39b8b1e96985e3982287618'
    ], '["I need to create my functional chart"]'::jsonb, array[]::text[], 'voice_only', false, null, null, null),
  ('role-description', array[
      '24656f4349aa0600ebaafe0dbfcd61ce'
    ], '["Write a role description for a seat on our Functional Chart","Write a role description for a role that is not on the chart"]'::jsonb, array['get_foundation', 'list_functions', 'get_role_description']::text[], 'voice_only', true, null, null, 8000),
  ('guide-meeting-debrief', array[
      'fcbdf1febeedb731da6cdb4da3b463bf',
      'db5f098fc335e4075a4a59a7760e0c88',
      '37245fdeec8ee070e2cb83c8201a381f',
      '01758c74a95198aa93242752d9bd41d8'
    ], '[]'::jsonb, array['get_meeting_debrief']::text[], 'full_coach', true, 'scripted', 'I talk through a leadership meeting with you once its summary is written. What happened in your last one that you want to think through?', null),
  ('vivid-vision', array[
      '2cc170ba381decb66b9b9b9181ae3c03',
      '59df28f8141f7df1c51c1daec9bbf9e6',
      'f2a9d0891ae15ce5d4b139ad16d4bb8a',
      '7a4c461e47ac0f90059abf24ea5abd05',
      'c11e4e25df4412961b3bed0ab766b8e7'
    ], '["Guide my leadership team through a 10-year vivid vision","I''m the owner. Help me create a vivid vision on my own","Turn our purpose and strengths into a vivid vision"]'::jsonb, array['get_foundation']::text[], 'voice_only', true, null, null, 8000)

)
update public.agent_versions v
set follows_code = true
from public.agents a, code c
where v.agent_id = a.id
  and a.slug = c.slug
  and md5(regexp_replace(v.prompt, '^\s+|\s+$', '', 'g')) = any (c.prompt_md5s)
  and v.chips = c.chips
  and coalesce(v.tools, '{}') = c.tools
  and v.base_prompt_mode = c.base_prompt_mode
  and v.skip_setup = c.skip_setup
  and v.first_turn is not distinct from c.first_turn
  and v.scripted_opener is not distinct from c.scripted_opener
  and v.max_tokens is not distinct from c.max_tokens
  and v.model is null;

-- ---- The distributed insert carries the mark ---------------------

drop function if exists public.insert_distributed_agent_version(
  uuid, integer, text, jsonb, text, boolean, text, text, text[],
  integer, text, text, uuid
);

create or replace function public.insert_distributed_agent_version(
  target_agent_id uuid,
  v_version_number integer,
  v_prompt text,
  v_chips jsonb,
  v_base_prompt_mode text,
  v_skip_setup boolean,
  v_first_turn text,
  v_scripted_opener text,
  v_tools text[],
  v_max_tokens integer,
  v_model text,
  v_publish_notes text,
  v_actor uuid,
  v_follows_code boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  -- As 0230: a version row is never written without naming a person.
  if v_actor is null then
    raise exception 'insert_distributed_agent_version requires an actor'
      using errcode = 'check_violation';
  end if;

  -- As 0230: only for agents managed from another instance.
  -- Allowed roles: service_role only (the grant below), from the
  -- authoring instance's push.
  if not exists (
    select 1 from public.agents a
    where a.id = target_agent_id and a.managed_from is not null
  ) then
    raise exception 'insert_distributed_agent_version is only for agents managed from another instance'
      using errcode = 'check_violation';
  end if;

  insert into public.agent_versions (
    agent_id, version_number, prompt, chips, base_prompt_mode,
    skip_setup, first_turn, scripted_opener, output_card, tools,
    max_tokens, model, publish_notes, published_by, published_at,
    follows_code
  ) values (
    target_agent_id, v_version_number, v_prompt,
    coalesce(v_chips, '[]'::jsonb), v_base_prompt_mode,
    coalesce(v_skip_setup, false), v_first_turn, v_scripted_opener,
    '{}'::jsonb, coalesce(v_tools, '{}'), v_max_tokens, v_model,
    coalesce(v_publish_notes, ''), v_actor, now(),
    coalesce(v_follows_code, false)
  )
  on conflict (agent_id, version_number) do nothing
  returning id into new_id;

  if new_id is null then
    select id into new_id
    from public.agent_versions
    where agent_id = target_agent_id
      and version_number = v_version_number;
  end if;

  return new_id;
end;
$$;

revoke all on function public.insert_distributed_agent_version(
  uuid, integer, text, jsonb, text, boolean, text, text, text[],
  integer, text, text, uuid, boolean
) from public;
revoke all on function public.insert_distributed_agent_version(
  uuid, integer, text, jsonb, text, boolean, text, text, text[],
  integer, text, text, uuid, boolean
) from anon;
revoke all on function public.insert_distributed_agent_version(
  uuid, integer, text, jsonb, text, boolean, text, text, text[],
  integer, text, text, uuid, boolean
) from authenticated;
grant execute on function public.insert_distributed_agent_version(
  uuid, integer, text, jsonb, text, boolean, text, text, text[],
  integer, text, text, uuid, boolean
) to service_role;
