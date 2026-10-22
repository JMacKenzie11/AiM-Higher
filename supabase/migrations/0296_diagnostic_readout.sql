-- =============================================================
-- Migration 0296: the Capacity Diagnostic's readout (phase 2)
--
-- WHY. Jason, 2026-10-22 (Capacity Diagnostic Module: AiMS HQ Build
-- Spec, phase 2): the readout step, the narrative and quote calls, the
-- PDF, Publish, Record decision and the Markdown download.
--
-- WHAT IT ADDS.
--   diagnostics      data_at_risk and guardrail_rules (the guardrails
--                    snapshot, entered on the Build step), roadmap (the
--                    90-day roadmap: up to three next wins, each with a
--                    target week and a champion, entered on the Readout
--                    step), narrative (the readout writer's paragraphs,
--                    one per section, editable until publishing),
--                    published_readout (the whole readout as published),
--                    decided_at.
--   diagnostic_notes destination_hours: the hours a week this person's
--                    time back goes to the Capacity Destination, which
--                    the readout sums per role.
--
-- PUBLISHED IS FROZEN, now for the engagement row too. Publish writes
-- published_at and published_readout together (a check holds them
-- together), and the PDF and the readout page render from
-- published_readout from then on. After that, a trigger refuses any
-- change to the row except the decision, its date, the status it moves
-- and archiving: Publish is one way, and what the owner was given cannot
-- drift. 0294 already freezes the notes and quotes.
--
-- ACCESS. No new table and no new grant: the new columns sit under
-- 0294's system-admin-only policies and 0295's primary-instance rule.
--
-- Harness probe "diagnostics · system admin only" (a published
-- diagnostic's readout cannot be edited).
-- =============================================================

alter table public.diagnostics
  add column if not exists data_at_risk text
    check (data_at_risk is null or length(data_at_risk) <= 2000),
  add column if not exists guardrail_rules text
    check (guardrail_rules is null or length(guardrail_rules) <= 2000),
  add column if not exists roadmap jsonb not null default '[]'::jsonb
    check (jsonb_typeof(roadmap) = 'array' and jsonb_array_length(roadmap) <= 3),
  add column if not exists narrative jsonb
    check (narrative is null or jsonb_typeof(narrative) = 'object'),
  add column if not exists published_readout jsonb
    check (published_readout is null or jsonb_typeof(published_readout) = 'object'),
  add column if not exists decided_at timestamptz;

alter table public.diagnostics
  drop constraint if exists diagnostics_published_together;
alter table public.diagnostics
  add constraint diagnostics_published_together
  check ((published_at is null) = (published_readout is null));

alter table public.diagnostic_notes
  add column if not exists destination_hours numeric(4, 1)
    check (destination_hours is null or (destination_hours >= 0 and destination_hours <= 40));

-- ---- The freeze --------------------------------------------------

create or replace function public.diagnostics_freeze_published()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.published_at is not null
     and (to_jsonb(new) - array['decision', 'decided_at', 'status', 'archived_at'])
         is distinct from
         (to_jsonb(old) - array['decision', 'decided_at', 'status', 'archived_at'])
  then
    raise exception 'This diagnostic''s readout is published and cannot change.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.diagnostics_freeze_published() from public, anon, authenticated;

drop trigger if exists diagnostics_freeze_published on public.diagnostics;
create trigger diagnostics_freeze_published
  before update on public.diagnostics
  for each row execute function public.diagnostics_freeze_published();

-- ---- The two new calls' cost log purposes ------------------------

alter table public.coach_token_usage
  drop constraint if exists coach_token_usage_purpose_check;

alter table public.coach_token_usage
  add constraint coach_token_usage_purpose_check
  check (purpose in (
    'turn',
    'title',
    'themes',
    'analyzer',
    'rd',
    'strengths',
    'brief',
    'clarity',
    'facilitation',
    'facilitation_retry',
    'insights_analysis',
    'memory',
    'speakers',
    'coverage',
    'questions',
    'invitation',
    'principles_check',
    'session_brief',
    'headlines',
    'diagnostic_titles',
    'diagnostic_quotes',
    'diagnostic_readout',
    'other'
  ));
