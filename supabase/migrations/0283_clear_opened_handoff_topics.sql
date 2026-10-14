-- 0283: the sweep also clears a topic left on a handoff that was opened.
--
-- 0282 blanks the topic as a link is opened, and on expiry. Handoffs
-- opened before 0282 (on the dev clone, where it was tested) kept
-- theirs, and nothing else would clear them before they expire. The
-- sweep now clears any topic on a handoff that is opened OR expired, and
-- runs once here, so no opened handoff keeps its topic anywhere.

-- Roles: none. Blanks topics; reads nothing out, admits nobody.
create or replace function public.clear_expired_aimee_handoff_topics()
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  with cleared as (
    update public.aimee_handoffs set topic = null
     where topic is not null and (used_at is not null or expires_at <= now())
    returning 1
  )
  select count(*)::integer from cleared
$$;

revoke all on function public.clear_expired_aimee_handoff_topics() from public, anon, authenticated;

select public.clear_expired_aimee_handoff_topics();
