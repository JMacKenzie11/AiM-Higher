-- =============================================================
-- Migration 0265: lead meeting analyses
--
-- The free meeting analysis offered to prospects (Jason,
-- 2026-10-13). A system admin enters a person's name, email, company
-- and role, uploads a leadership meeting transcript, and the same
-- analysis a client meeting gets runs on it. The result is kept here
-- and rendered as a branded PDF at /meetinganalysis/<id>/pdf.
--
-- FULLY SEPARATE from client data, on purpose. No company_id, no
-- meeting_id, nothing that joins to a tenant. A prospect is not a
-- company on this platform, and if they become one the analysis does
-- not follow them (Jason, 2026-10-13).
--
-- The analysis columns mirror meeting_analyses (analysis_markdown,
-- commitments_json, issues_json, facilitation_review_json, the five
-- score parts, the weights that made the overall) so the same
-- renderers and the same score arithmetic read both. Commitments here
-- name their owner as text: there is no roster to hold a profile id.
--
-- Access:
--   select   system admins only.
--   insert   system admins only, as themselves (created_by).
--   update   nobody through the API. The analysis is written by the
--            server with the service role, which bypasses RLS.
--   delete   nobody through the API.
-- =============================================================

create table if not exists public.lead_meeting_analyses (
  id uuid primary key default gen_random_uuid(),
  -- Who it was prepared for.
  full_name text not null check (length(btrim(full_name)) > 0),
  email text not null check (position('@' in email) > 1),
  company_name text not null check (length(btrim(company_name)) > 0),
  role_title text,
  -- What was analysed.
  file_name text,
  transcript_text text not null check (length(btrim(transcript_text)) > 0),
  -- pending -> analyzing -> complete | failed
  status text not null default 'pending'
    check (status in ('pending', 'analyzing', 'complete', 'failed')),
  error text,
  -- The analysis, as meeting_analyses stores it.
  analysis_markdown text,
  truncated boolean not null default false,
  commitments_json jsonb not null default '[]'::jsonb check (jsonb_typeof(commitments_json) = 'array'),
  issues_json jsonb not null default '[]'::jsonb check (jsonb_typeof(issues_json) = 'array'),
  facilitation_review_json jsonb,
  score_positive_framing smallint,
  score_rhythm smallint,
  score_accountability smallint,
  score_alignment smallint,
  score_agenda smallint,
  score_overall numeric(4, 2),
  score_weights jsonb,
  model text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

comment on table public.lead_meeting_analyses is
  'Free meeting analyses for prospects (0265). Separate from all '
  'company data. System admins read and insert; the server writes '
  'the analysis.';

create index if not exists lead_meeting_analyses_created
  on public.lead_meeting_analyses (created_at desc);

alter table public.lead_meeting_analyses enable row level security;
alter table public.lead_meeting_analyses force row level security;

revoke all on public.lead_meeting_analyses from public;
revoke all on public.lead_meeting_analyses from anon;
revoke all on public.lead_meeting_analyses from authenticated;
grant select, insert on public.lead_meeting_analyses to authenticated;

-- Reads: system_admin only.
drop policy if exists lead_meeting_analyses_select on public.lead_meeting_analyses;
create policy lead_meeting_analyses_select on public.lead_meeting_analyses
  for select to authenticated
  using ((select public.auth_role()) = 'system_admin');

-- Writes: system_admin only, as themselves. Allowed roles: system_admin.
drop policy if exists lead_meeting_analyses_insert on public.lead_meeting_analyses;
create policy lead_meeting_analyses_insert on public.lead_meeting_analyses
  for insert to authenticated
  with check (
    (select public.auth_role()) = 'system_admin'
    and created_by = (select auth.uid())
  );
