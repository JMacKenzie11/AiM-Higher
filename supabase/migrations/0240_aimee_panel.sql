-- =============================================================
-- Migration 0240 — Aimee's panel: where a conversation started, and
-- counting panel use
--
-- docs/investigations/aimee-panel.md, "Coach memory in the panel" and
-- "Counting panel use and help answers".
--
-- ---- 1. coaching_conversations.origin ---------------------------
--
-- 'page' (the Aimee page, and everything before this) or 'panel'
-- (started in Aimee's panel). Set once, at creation, by the panel's
-- create action.
--
-- It exists for coach memory. A conversation started in the panel
-- never writes to memory, even when it is later opened on the Aimee
-- page: the sweep skips it and the route leaves remember_this out of
-- its tools. Both read this column, never the surface the person is
-- on, so where the conversation is opened later changes nothing.
--
-- A routing fact, not a permission. The owner can in principle change
-- it through the existing update policy, but it only governs their
-- own memory, so there is nobody to protect. No probe of its own.
--
-- ---- 2. aimee_panel_events ---------------------------------------
--
-- One row per panel open, per help search, and per "Continue on the
-- Aimee page", read by `npm run aimee:uptake` beside the other weekly
-- reports, which read the database rather than a third party's
-- retention.
--
-- NO QUERY TEXT AND NO PAGE CONTENT. A search can hold personal
-- detail, and coaching is private, so a row says only that something
-- happened, to whom, and, for a search, whether it found anything.
--
-- Access:
--   insert  your own row, for a company you are in (your own company,
--           an assigned one for a guide, any for a system admin).
--           portfolio_admin has no home company, so the company
--           predicate never admits it: its writes stay on its four
--           tables (CLAUDE.md, Permissions).
--   select  system admins only. Nobody reads anyone's panel use,
--           including their own; the weekly report runs as the
--           service role.
--   update, delete   nobody. The privileges are revoked, not merely
--           left without a policy.
-- =============================================================

alter table public.coaching_conversations
  add column if not exists origin text not null default 'page';

alter table public.coaching_conversations
  drop constraint if exists coaching_conversations_origin_check;
alter table public.coaching_conversations
  add constraint coaching_conversations_origin_check
  check (origin in ('page', 'panel'));

comment on column public.coaching_conversations.origin is
  'Where the conversation was started: page (the Aimee page) or panel '
  '(Aimee''s panel). Panel conversations never write coach memory. '
  'Set once at creation.';

create table if not exists public.aimee_panel_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('opened', 'help_search', 'continue_on_page')),
  -- For a help search: did it find anything. Null for the other kinds.
  found boolean,
  created_at timestamptz not null default now(),
  constraint aimee_panel_events_found_only_for_search
    check ((kind = 'help_search') = (found is not null))
);

comment on table public.aimee_panel_events is
  'Counts of Aimee panel use and help searches, for npm run aimee:uptake. '
  'Holds no query text and no page content, by design.';

create index if not exists aimee_panel_events_company_created
  on public.aimee_panel_events (company_id, created_at);

alter table public.aimee_panel_events enable row level security;

revoke all on public.aimee_panel_events from anon;
revoke update, delete, truncate on public.aimee_panel_events from authenticated;
grant select, insert on public.aimee_panel_events to authenticated;

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
      or public.is_guide_for(aimee_panel_events.company_id)
    )
  );

drop policy if exists aimee_panel_events_select on public.aimee_panel_events;
create policy aimee_panel_events_select on public.aimee_panel_events
  for select to authenticated
  using ((select public.auth_role()) = 'system_admin');
