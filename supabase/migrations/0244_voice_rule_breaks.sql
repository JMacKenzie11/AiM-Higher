-- =============================================================
-- Migration 0244 — counting Aimee replies shown with a voice rule
-- broken, and closing a portfolio_admin write that 0240 opened
--
-- ---- 1. voice_rule_breaks ---------------------------------------
--
-- Jason, 2026-09-29. Two kinds of reply reach people with a banned
-- phrase still in them, and he wants to see how often before deciding
-- anything more:
--
--   debrief_reply / opener   a checked turn, sent back once, shown
--                            with a rule still broken because the
--                            retry did not fix everything (the better
--                            of the two attempts is shown, never a
--                            blank).
--   conversation             an ordinary Aimee conversation, on the
--                            page or in the panel. Not checked or
--                            retried (it streams); counted.
--
-- One row per reply shown with something still broken. Read by
-- `npm run aimee:uptake`.
--
-- NO REPLY TEXT. Coaching is private. A row says which rules, on which
-- surface, in which company, and when; never what was said. The rule
-- names are the banned list's own labels ("the room", "X instead of
-- Y"), which are the list's words, not the reply's.
--
-- Access, the same shape as aimee_panel_events (0240), written the way
-- 0240 should have been (section 2):
--   insert  your own row, for a company you are in: your own company,
--           an ASSIGNED GUIDE's company (is_assigned_guide_for, never
--           is_guide_for, which also admits an assigned portfolio
--           admin), or any for a system admin.
--   select  system admins only.
--   update, delete   nobody; the privileges are revoked.
--
-- ---- 2. aimee_panel_events: guides only, not portfolio admins ----
--
-- 0240's insert policy admits `is_guide_for(company_id)`. Since 0199
-- that is a wrapper over is_admin_for(), which also admits an assigned
-- portfolio_admin, so 0240 gave portfolio_admin an insert on a table
-- outside its closed list of four (CLAUDE.md, Permissions). Its own
-- header said the opposite. rls:hazards did not catch it: it matches a
-- policy that names the role, and this one reaches it through a
-- function. The app never inserts for a portfolio admin
-- (recordPanelEvent returns first), but RLS is the boundary.
--
-- 0240 has reached the dev clone only, so this corrects it in place of
-- editing an applied file (failure mode E2). Probed by the harness:
-- an assigned portfolio admin's insert is refused on both tables, and
-- an assigned guide's still succeeds.
-- =============================================================

create table if not exists public.voice_rule_breaks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  surface text not null check (surface in ('debrief_reply', 'opener', 'conversation')),
  -- For a conversation: where it was started (coaching_conversations
  -- .origin). Null for the checked surfaces, which are page-only.
  origin text check (origin in ('page', 'panel')),
  -- The banned list's labels for what was still broken. At least one.
  rules text[] not null check (cardinality(rules) > 0),
  created_at timestamptz not null default now()
);

comment on table public.voice_rule_breaks is
  'One row per Aimee reply shown with a voice rule still broken: which '
  'rules, which surface, which company. For npm run aimee:uptake. Holds '
  'no reply text, by design.';

create index if not exists voice_rule_breaks_created
  on public.voice_rule_breaks (created_at);

alter table public.voice_rule_breaks enable row level security;
alter table public.voice_rule_breaks force row level security;

revoke all on public.voice_rule_breaks from anon;
revoke update, delete, truncate on public.voice_rule_breaks from authenticated;
grant select, insert on public.voice_rule_breaks to authenticated;

drop policy if exists voice_rule_breaks_insert on public.voice_rule_breaks;
create policy voice_rule_breaks_insert on public.voice_rule_breaks
  for insert to authenticated
  with check (
    profile_id = (select auth.uid())
    and (
      (select public.auth_role()) = 'system_admin'
      or (
        (select public.auth_company_id()) is not null
        and (select public.auth_company_id()) = voice_rule_breaks.company_id
      )
      or public.is_assigned_guide_for(voice_rule_breaks.company_id)
    )
  );

drop policy if exists voice_rule_breaks_select on public.voice_rule_breaks;
create policy voice_rule_breaks_select on public.voice_rule_breaks
  for select to authenticated
  using ((select public.auth_role()) = 'system_admin');

-- ---- 2. aimee_panel_events, guides only ------------------------

drop policy if exists aimee_panel_events_insert on public.aimee_panel_events;
create policy aimee_panel_events_insert on public.aimee_panel_events
  for insert to authenticated
  with check (
    profile_id = (select auth.uid())
    and (
      (select public.auth_role()) = 'system_admin'
      or (
        (select public.auth_company_id()) is not null
        and (select public.auth_company_id()) = aimee_panel_events.company_id
      )
      or public.is_assigned_guide_for(aimee_panel_events.company_id)
    )
  );
