-- =============================================================
-- Migration 0142: widen meeting visibility to team members
--
-- Meeting summaries were previously admin-only (system_admin +
-- routed company_admin + assigned aims_guide). Team members now
-- see the same list + analysis narrative so the "summary" is a
-- shared artefact, not an admin secret. Facilitation reviews and
-- raw transcript_text remain admin-only via app-level gating —
-- only server code touches meetings.transcript_text and only
-- admin surfaces render facilitation_review_json.
--
-- Additive: a new *_select_member policy per table. Existing
-- admin + guide policies (migration 0108, 0111) stay intact so
-- no admin loses access if this gets reverted.
-- =============================================================

-- ---- meetings: same-company member SELECT --------------------
drop policy if exists meetings_select_member on public.meetings;
create policy meetings_select_member on public.meetings
for select to authenticated
using (
  public.meetings.company_id is not null
  and exists (
    select 1 from public.auth_profile() ap
    where ap.company_id is not null
      and ap.company_id = public.meetings.company_id
  )
);

-- ---- meeting_analyses: same-company member SELECT ------------
drop policy if exists meeting_analyses_select_member on public.meeting_analyses;
create policy meeting_analyses_select_member on public.meeting_analyses
for select to authenticated
using (
  exists (
    select 1
    from public.meetings m
    join public.auth_profile() ap on true
    where m.id = public.meeting_analyses.meeting_id
      and m.company_id is not null
      and ap.company_id is not null
      and ap.company_id = m.company_id
  )
);
