-- =============================================================
-- Migration 0315: tool access is tracked per automation
--
-- WHY. Jason, 2026-11-01: systems and tool access are not settled up
-- front in the diagnostic's Pre-flight; he identifies the systems and
-- secures access as he takes on each process to automate. So access
-- belongs to the automation it is for.
--
-- WHAT IT ADDS. Two columns on diagnostic_automations:
--   access_status  null (not tracked), 'waiting' or 'secured'. Null
--                  for every automation already there, so none of them
--                  starts out saying it is waiting.
--   access_note    what is needed, in a line. The client sees it beside
--                  "Waiting on access" on their dashboard, so it is
--                  written for them.
--
-- ACCESS. No rule changes. The columns ride on the table's rules as
-- 0306 and 0307 left them: system admins write, a diagnostic client
-- reads its own client's rows. Probe "diagnostic client · own client
-- only" still covers the read.
-- =============================================================

alter table public.diagnostic_automations
  add column if not exists access_status text check (access_status is null or access_status in ('waiting', 'secured')),
  add column if not exists access_note text check (access_note is null or length(access_note) <= 300);

comment on column public.diagnostic_automations.access_status is
  'Tool access for this automation (0315): null not tracked, waiting, or secured.';
comment on column public.diagnostic_automations.access_note is
  'What is needed for access, in a line (0315). The client sees it on their dashboard while access is waiting.';
