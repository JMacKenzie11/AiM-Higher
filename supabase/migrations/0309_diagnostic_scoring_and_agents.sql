-- =============================================================
-- Migration 0309: the Capacity Diagnostic's scoring, the owner's week,
-- the voice and limits, and the recommended agent team
--
-- WHY. Jason, 2026-10-29 (the diagnostic upgrade brief): structure the
-- task scoring so candidates rank by hours, data risk and build effort;
-- ask the owner where their own week goes; capture where requests come
-- in and what the business already has written down; capture how the
-- business sounds and what an agent must never do alone; and recommend
-- the agent team the builds add up to.
--
-- ADDITIVE ONLY. Every new column is nullable or defaulted, so every
-- diagnostic, and every published readout, reads as before.
--
--   diagnostic_tasks  frequency (daily, weekly, monthly, ad_hoc);
--                     build_effort (half_day, one_two_days, more), in
--                     place of build_effort_hours, which stays for the
--                     record and is converted below; needs_approval;
--                     agent_type (what kind of agent would do it, or
--                     not_suitable)
--   diagnostics       owner_wish_list, owner_away_breaks,
--                     owner_bottlenecks (the owner's week, Kickoff);
--                     intake_channels and intake_other (where requests
--                     come in); knowledge_base (what is written down, and
--                     where it lives); brand_voice; never_alone and
--                     never_alone_other (what an agent never does alone);
--                     agent_team (the lead's edited agent team; null
--                     until edited, when the suggestion shows)
--
-- THE CONVERSION. A task's build hours become a build effort: 4 hours or
-- less is half a day or less, up to 16 is one to two days, more is more
-- than two days. Only where build_effort is still empty.
--
-- ACCESS. Unchanged: system admin only, primary instance only (0294,
-- 0295). A published diagnostic stays frozen (0296's trigger covers the
-- new columns as it covers every column).
-- =============================================================

alter table public.diagnostic_tasks
  add column if not exists frequency text
    check (frequency is null or frequency in ('daily', 'weekly', 'monthly', 'ad_hoc')),
  add column if not exists build_effort text
    check (build_effort is null or build_effort in ('half_day', 'one_two_days', 'more')),
  add column if not exists needs_approval boolean,
  add column if not exists agent_type text
    check (agent_type is null or agent_type in (
      'inbox_triage', 'reporting', 'content', 'scheduling', 'ops_log', 'customer_follow_up', 'not_suitable'
    ));

update public.diagnostic_tasks
   set build_effort = case
     when build_effort_hours <= 4 then 'half_day'
     when build_effort_hours <= 16 then 'one_two_days'
     else 'more'
   end
 where build_effort is null and build_effort_hours is not null;

alter table public.diagnostics
  add column if not exists owner_wish_list text
    check (owner_wish_list is null or length(owner_wish_list) <= 2000),
  add column if not exists owner_away_breaks text
    check (owner_away_breaks is null or length(owner_away_breaks) <= 2000),
  add column if not exists owner_bottlenecks text
    check (owner_bottlenecks is null or length(owner_bottlenecks) <= 2000),
  add column if not exists intake_channels text[] not null default '{}'
    check (intake_channels <@ array['email', 'chat', 'phone', 'crm', 'web_forms']::text[]),
  add column if not exists intake_other text
    check (intake_other is null or length(intake_other) <= 500),
  add column if not exists knowledge_base jsonb
    check (knowledge_base is null or jsonb_typeof(knowledge_base) = 'object'),
  add column if not exists brand_voice text
    check (brand_voice is null or length(brand_voice) <= 2000),
  add column if not exists never_alone text[] not null default '{}'
    check (never_alone <@ array['send_messages', 'make_payments', 'delete_data', 'quote_pricing', 'commit_dates']::text[]),
  add column if not exists never_alone_other text
    check (never_alone_other is null or length(never_alone_other) <= 500),
  add column if not exists agent_team jsonb
    check (agent_team is null or (jsonb_typeof(agent_team) = 'array' and jsonb_array_length(agent_team) <= 6));
