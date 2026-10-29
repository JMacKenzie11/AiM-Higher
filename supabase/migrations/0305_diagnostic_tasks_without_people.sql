-- =============================================================
-- Migration 0305: Capacity Diagnostic tasks without people
--
-- WHY. Jason, 2026-10-29: hide the people interviews (survey,
-- conversations, the people list, the pledge, the quotes) and focus the
-- diagnostic on systems and process. The lead now enters each task
-- during the systems walkthrough, with the role that does it, not the
-- person, and nobody rates its energy or judgment.
--
--   diagnostic_tasks  participant_id may be null, for a task the lead
--                     entered (source 'lead'); energy and judgment may
--                     be null, both or neither; role_title says who
--                     does it when no person is attached
--   diagnostics       ai_tools: the one company-level question, what
--                     AI tools the team uses, in place of each person's
--                     answers
--
-- Loosening only. No row changes, no constraint gets stricter for a
-- row that exists, and the interview tables stay as they are, so the
-- interviews can come back.
--
-- ACCESS. Unchanged: system admin only, primary instance only, as
-- 0294 and 0295 set it. No policy is touched, no role added.
-- =============================================================

alter table public.diagnostic_tasks
  alter column participant_id drop not null,
  alter column energy drop not null,
  alter column judgment drop not null,
  add column if not exists role_title text
    check (role_title is null or length(role_title) <= 120);

-- A task with no person is one the lead entered.
alter table public.diagnostic_tasks
  drop constraint if exists diagnostic_tasks_person_or_lead;
alter table public.diagnostic_tasks
  add constraint diagnostic_tasks_person_or_lead
  check (participant_id is not null or source = 'lead');

-- Rated on both scales or on neither, so a half-rated task cannot
-- slip between the rule and the score.
alter table public.diagnostic_tasks
  drop constraint if exists diagnostic_tasks_rated_together;
alter table public.diagnostic_tasks
  add constraint diagnostic_tasks_rated_together
  check ((energy is null) = (judgment is null));

alter table public.diagnostics
  add column if not exists ai_tools text
    check (ai_tools is null or length(ai_tools) <= 2000);
