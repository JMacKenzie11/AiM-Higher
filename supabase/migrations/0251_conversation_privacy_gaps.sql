-- 0251: close the gaps around Aimee conversations' privacy
-- (docs/investigations/open-data.md, phase B; decisions 2026-10-01).
--
-- THE PRINCIPLE. Only the person who started a conversation can know it
-- exists, read it or query its history, unless they share it. That
-- holds for every role, company admins, guides, portfolio admins and
-- system admins included. The read rules on the conversation tables
-- already say so; these are the ways around them that the
-- investigation found in the database.
--
-- 1. A DEBRIEF INVITATION IS ITS RECIPIENT'S ALONE (decision 3).
--    guide_nudges carries conversation_id, the state (opened or
--    dismissed) and opened_at. Its read rule let the company's admins,
--    assigned guides, assigned portfolio admins and system admins read
--    every invitation in the company, so they could see that somebody's
--    debrief conversation existed and when it was opened. Now only the
--    recipient reads it. Nothing in the app read another person's
--    invitation (src/lib/guide reads by recipient); the weekly counts
--    (guide_nudge_weekly, npm run guide:uptake) are read with the
--    service role and are unchanged.
--
-- 2. coach_memory_metadata GOES. It let a system admin count anyone's
--    memories and see when they were written. Nothing calls it.
--
-- 3. THE SHARE CHECKS ARE NOT FOR SIGNED-OUT CALLERS.
--    is_coaching_conversation_owner, has_coaching_share and
--    has_coaching_write_share take any (conversation, person) pair and
--    were granted to anon, so anybody holding a conversation id could
--    ask who owns it. The read rules that call them are for
--    authenticated only, so nothing signed out needs them.

-- ---- 1 -----------------------------------------------------------------
-- Roles: the recipient only, whatever their role. No admin, guide,
-- portfolio admin or system admin branch.
drop policy if exists guide_nudges_select on public.guide_nudges;
create policy guide_nudges_select on public.guide_nudges
for select to authenticated
using (recipient_profile_id = (select auth.uid()));

-- ---- 2 -----------------------------------------------------------------
drop function if exists public.coach_memory_metadata(uuid);

-- ---- 3 -----------------------------------------------------------------
revoke execute on function public.is_coaching_conversation_owner(uuid, uuid) from anon;
revoke execute on function public.has_coaching_share(uuid, uuid) from anon;
revoke execute on function public.has_coaching_write_share(uuid, uuid) from anon;
