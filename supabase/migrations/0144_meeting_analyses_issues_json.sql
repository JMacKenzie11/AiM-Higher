-- =============================================================
-- Migration 0144: meeting_analyses.issues_json
--
-- Second array on the extraction pipeline: distinct problems,
-- tensions, or unresolved questions the team raised that weren't
-- resolved in the meeting. Stored alongside commitments_json,
-- never auto-created — the meeting summary surfaces them with an
-- "Add to open issues" action instead.
--
-- Backward compat: existing rows keep issues_json = null.
-- =============================================================

alter table public.meeting_analyses
  add column issues_json jsonb;

comment on column public.meeting_analyses.issues_json is
  'Extracted issues from the transcript. Never auto-created; the '
  'meeting summary page surfaces each with an "Add to open issues" '
  'action that creates an issues row on demand.';

-- =============================================================
-- Duplicate-awareness RPCs for the meeting summary.
-- For each extracted commitment / issue, look for a near-duplicate
-- OPEN item on file that was created recently. Uses pg_trgm's
-- similarity() function (extension enabled in migration 0143).
-- The threshold + since window come from the caller so an app-side
-- constant stays authoritative.
-- =============================================================

create or replace function public.find_similar_open_commitment(
  p_company_id uuid,
  p_text text,
  p_threshold real,
  p_since timestamptz
)
returns table (id uuid, description text, sim real)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.description, similarity(c.description, p_text) as sim
  from public.commitments c
  where c.company_id = p_company_id
    and c.status = 'open'
    and c.deleted_at is null
    and c.parked_at is null
    and c.created_at >= p_since
    and similarity(c.description, p_text) >= p_threshold
  order by similarity(c.description, p_text) desc
  limit 1;
$$;

revoke all on function public.find_similar_open_commitment(uuid, text, real, timestamptz) from public;
grant execute on function public.find_similar_open_commitment(uuid, text, real, timestamptz) to authenticated;
grant execute on function public.find_similar_open_commitment(uuid, text, real, timestamptz) to service_role;

create or replace function public.find_similar_open_issue(
  p_company_id uuid,
  p_text text,
  p_threshold real,
  p_since timestamptz
)
returns table (id uuid, title text, sim real)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.title, similarity(i.title, p_text) as sim
  from public.issues i
  where i.company_id = p_company_id
    and i.status = 'open'
    and i.created_at >= p_since
    and similarity(i.title, p_text) >= p_threshold
  order by similarity(i.title, p_text) desc
  limit 1;
$$;

revoke all on function public.find_similar_open_issue(uuid, text, real, timestamptz) from public;
grant execute on function public.find_similar_open_issue(uuid, text, real, timestamptz) to authenticated;
grant execute on function public.find_similar_open_issue(uuid, text, real, timestamptz) to service_role;
