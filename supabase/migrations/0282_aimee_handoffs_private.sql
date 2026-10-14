-- 0282: a handoff's topic is the person's alone, and it does not outlive
-- the link.
--
-- WHY. Jason, 2026-10-14: handoff records hold coaching topics, so they
-- follow the rule Aimee conversations follow. Only the person who
-- created one can ever read it; not a company admin, guide, portfolio
-- admin or system admin through the app. And the topic text is cleared
-- once the handoff is opened or expires; the row stays, without it, for
-- the record of what happened.
--
-- THE READ RULE, in two layers:
--   1. No read grant to anyone signed in (0281). The person gets their
--      topic once, through claim_aimee_handoff, when they open the link.
--   2. aimee_handoffs_owner_only, RESTRICTIVE: whatever grant or policy
--      anyone adds later, a row is visible only to its own creator. The
--      same shape as the private rule on Aimee conversations, so a future
--      "let admins see handoffs" cannot quietly work.
--
-- CLEARING THE TOPIC.
--   - On open: claim_aimee_handoff returns the topic and blanks it in the
--     same statement. The conversation it starts keeps it, as that
--     conversation's own private summary.
--   - On expiry: clear_expired_aimee_handoff_topics() blanks every
--     expired topic, run by pg_cron every 15 minutes in each database,
--     so it needs nothing from the app and runs on every instance. Every
--     claim also clears any expired topic it touches.

alter table public.aimee_handoffs alter column topic drop not null;
alter table public.aimee_handoffs drop constraint if exists aimee_handoffs_topic_check;
alter table public.aimee_handoffs
  add constraint aimee_handoffs_topic_check
  check (topic is null or char_length(btrim(topic)) between 1 and 500);

comment on column public.aimee_handoffs.topic is
  'The short topic an outside assistant handed over. Readable only by its creator, once, on opening; blanked on opening and on expiry (0282).';

-- Roles: none. Restrictive: a row is visible to its creator only,
-- whatever else is ever granted.
drop policy if exists aimee_handoffs_owner_only on public.aimee_handoffs;
create policy aimee_handoffs_owner_only on public.aimee_handoffs
  as restrictive for select to authenticated
  using (profile_id = (select auth.uid()));

-- Roles: the signed-in person, for their own handoff only. As 0281, and
-- now the topic is blanked in the same statement that marks it used, and
-- an expired topic is blanked when found.
create or replace function public.claim_aimee_handoff(p_token text)
returns table (handoff_id uuid, company_id uuid, topic text, state text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  h public.aimee_handoffs;
  hash text := encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
  t text;
begin
  if public.is_assistant() or auth.uid() is null then
    return query select null::uuid, null::uuid, null::text, 'refused'::text;
    return;
  end if;
  select * into h from public.aimee_handoffs a where a.token_sha256 = hash;
  if not found then
    return query select null::uuid, null::uuid, null::text, 'missing'::text;
  elsif h.profile_id <> auth.uid() then
    return query select null::uuid, null::uuid, null::text, 'not_yours'::text;
  elsif h.used_at is not null then
    return query select null::uuid, null::uuid, null::text, 'used'::text;
  elsif h.expires_at <= now() then
    update public.aimee_handoffs a set topic = null where a.id = h.id;
    return query select null::uuid, null::uuid, null::text, 'expired'::text;
  else
    update public.aimee_handoffs a set used_at = now(), topic = null
     where a.id = h.id and a.used_at is null
    returning h.topic into t;
    if not found or t is null then
      return query select null::uuid, null::uuid, null::text, 'used'::text;
    else
      return query select h.id, h.company_id, t, 'ok'::text;
    end if;
  end if;
end;
$$;

-- Roles: none. Blanks expired topics; reads nothing out, admits nobody.
-- Not callable by anyone signed in: pg_cron runs it.
create or replace function public.clear_expired_aimee_handoff_topics()
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  with cleared as (
    update public.aimee_handoffs set topic = null
     where topic is not null and expires_at <= now()
    returning 1
  )
  select count(*)::integer from cleared
$$;

revoke all on function public.clear_expired_aimee_handoff_topics() from public, anon, authenticated;

-- The schedule, in the database itself.
create extension if not exists pg_cron;
do $$
begin
  if exists (select 1 from cron.job where jobname = 'aimee-handoff-topics') then
    perform cron.unschedule('aimee-handoff-topics');
  end if;
  perform cron.schedule('aimee-handoff-topics', '*/15 * * * *', 'select public.clear_expired_aimee_handoff_topics()');
end $$;
