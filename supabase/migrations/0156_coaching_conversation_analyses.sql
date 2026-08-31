-- =============================================================
-- Migration 0156: per-conversation coaching analyses.
--
-- Feeds the "Coaching insights" card's Pass 2 + Pass 3 panes
-- (themes, friction, opportunities, agent×category heatmap).
--
-- Design: one row per coaching_conversation, produced by a
-- nightly Haiku call that reads the transcript, strips PII, and
-- returns a structured summary. Everything the dashboard needs
-- is stored as native columns / arrays / JSONB so the aggregation
-- layer can filter + group without another LLM call at read time.
--
-- PII rule (enforced in the prompt): every proper noun that
-- identifies a person, company, or product is replaced with a
-- generic role term ("the leader", "a report", "the company",
-- "the product"). The row is meant to be safe to surface at the
-- platform-admin level; the raw transcript never leaves the
-- caller's tenant.
--
-- Filled + read admin-side only (system_admin gate at route +
-- action). RLS below is belt-and-braces so a direct browser
-- query from a curious sysadmin also works.
-- =============================================================

create table public.coaching_conversation_analyses (
  conversation_id uuid primary key references public.coaching_conversations(id) on delete cascade,
  company_id      uuid not null references public.companies(id) on delete cascade,
  -- Optional practice_id (mirror of the source conversation) so the
  -- heatmap query doesn't need a join back to conversations.
  practice_id     text,
  -- One-sentence PII-stripped description of what the leader was
  -- working on. The card can quote this directly under a theme.
  summary         text not null,
  -- 1–4 short topic tags in plain business language. Drives the
  -- themes pane (group + count) and the heatmap axis.
  topics          text[] not null default '{}',
  -- 0 = informational / neutral
  -- 1 = mild friction
  -- 2 = frustrated
  -- 3 = stuck / repeated attempts
  friction_level  smallint not null default 0 check (friction_level between 0 and 3),
  -- Short phrase naming the friction if level > 0.
  friction_signal text,
  -- If the convo hints at a platform-product opportunity, a short
  -- phrase describing it. Optional — most rows will be null.
  opportunity     text,
  -- Provenance so a future prompt version can invalidate + re-run.
  model           text,
  prompt_version  int  not null default 1,
  analyzed_at     timestamptz not null default now()
);

create index coaching_conversation_analyses_company_idx
  on public.coaching_conversation_analyses (company_id, analyzed_at desc);

create index coaching_conversation_analyses_analyzed_at_idx
  on public.coaching_conversation_analyses (analyzed_at desc);

-- ---- RLS ---------------------------------------------------
alter table public.coaching_conversation_analyses enable row level security;
alter table public.coaching_conversation_analyses force row level security;

create policy coaching_conversation_analyses_select
on public.coaching_conversation_analyses
for select to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
  )
);
