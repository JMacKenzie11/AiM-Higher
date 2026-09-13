-- =============================================================
-- Migration 0180: F8 batch 5 — the nullable-company_id group.
--
-- meetings, meeting_analyses, transcript_sources,
-- transcript_aliases, transcript_source_audit_log. Thirteen
-- policies, transcribed from pg_policies on production. The twelve
-- _guide policies are untouched.
--
-- THIS IS THE GROUP HAZARD 1 WAS WRITTEN FOR. Three of these tables
-- carry a NULLABLE company_id: a transcript source with 'shared'
-- scope serves several companies and has none of its own, and a
-- meeting that arrived before its folder was routed has none yet.
-- Every system_admin and every aims_guide also has no company. So a
-- caller with no company can be compared against a row with no
-- company, and `IS NOT DISTINCT FROM` would turn that denial into an
-- allow. `=` does not, which is why the static check has refused that
-- idiom in tenant predicates since batch 1.
--
-- EVERY `is not null` GUARD IS PRESERVED EXACTLY. On these tables
-- they are not decoration. meetings_select_member leads with
-- `company_id is not null` before it compares anything, and
-- meetings_select repeats the guard inside the company_admin branch.
-- Both are transcribed unchanged. This migration changes how the
-- helper is evaluated and nothing about who is admitted.
--
-- NOTE FOR THE PR THAT FOLLOWS THIS ONE. The transcript_sources
-- write policies below are system_admin only, and the app grants
-- those actions to company_admins through a service-role client that
-- never consults RLS — failure mode E5's second specimen. Bringing
-- them back inside RLS is a SEMANTIC change and is deliberately not
-- in this migration. It lands next, against these policies in their
-- final form-D shape.
-- =============================================================

-- ---- meetings -------------------------------------------------

drop policy if exists meetings_select on public.meetings;
create policy meetings_select on public.meetings
for select to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and public.meetings.company_id is not null
    and (select public.auth_company_id()) = public.meetings.company_id
  )
);

drop policy if exists meetings_select_member on public.meetings;
create policy meetings_select_member on public.meetings
for select to authenticated
using (
  public.meetings.company_id is not null
  and (select public.auth_company_id()) is not null
  and (select public.auth_company_id()) = public.meetings.company_id
);

drop policy if exists meetings_update_admin on public.meetings;
create policy meetings_update_admin on public.meetings
for update to authenticated
using ((select public.auth_role()) = 'system_admin')
with check ((select public.auth_role()) = 'system_admin');

-- ---- meeting_analyses -----------------------------------------

drop policy if exists meeting_analyses_select on public.meeting_analyses;
create policy meeting_analyses_select on public.meeting_analyses
for select to authenticated
using (
  exists (
    select 1 from public.meetings m
    where m.id = public.meeting_analyses.meeting_id
      and (
        (select public.auth_role()) = 'system_admin'
        or (
          (select public.auth_role()) = 'company_admin'
          and m.company_id is not null
          and (select public.auth_company_id()) = m.company_id
        )
      )
  )
);

drop policy if exists meeting_analyses_select_member on public.meeting_analyses;
create policy meeting_analyses_select_member on public.meeting_analyses
for select to authenticated
using (
  exists (
    select 1 from public.meetings m
    where m.id = public.meeting_analyses.meeting_id
      and m.company_id is not null
      and (select public.auth_company_id()) is not null
      and (select public.auth_company_id()) = m.company_id
  )
);

-- ---- transcript_sources ---------------------------------------

drop policy if exists transcript_sources_select on public.transcript_sources;
create policy transcript_sources_select on public.transcript_sources
for select to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and public.transcript_sources.company_id is not null
    and (select public.auth_company_id()) = public.transcript_sources.company_id
  )
);

drop policy if exists transcript_sources_insert on public.transcript_sources;
create policy transcript_sources_insert on public.transcript_sources
for insert to authenticated
with check ((select public.auth_role()) = 'system_admin');

drop policy if exists transcript_sources_update on public.transcript_sources;
create policy transcript_sources_update on public.transcript_sources
for update to authenticated
using ((select public.auth_role()) = 'system_admin')
with check ((select public.auth_role()) = 'system_admin');

drop policy if exists transcript_sources_delete on public.transcript_sources;
create policy transcript_sources_delete on public.transcript_sources
for delete to authenticated
using ((select public.auth_role()) = 'system_admin');

-- ---- transcript_aliases ---------------------------------------

drop policy if exists transcript_aliases_select on public.transcript_aliases;
create policy transcript_aliases_select on public.transcript_aliases
for select to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_company_id()) is not null
    and (select public.auth_company_id()) = public.transcript_aliases.company_id
  )
);

drop policy if exists transcript_aliases_insert on public.transcript_aliases;
create policy transcript_aliases_insert on public.transcript_aliases
for insert to authenticated
with check ((select public.auth_role()) = 'system_admin');

drop policy if exists transcript_aliases_update on public.transcript_aliases;
create policy transcript_aliases_update on public.transcript_aliases
for update to authenticated
using ((select public.auth_role()) = 'system_admin')
with check ((select public.auth_role()) = 'system_admin');

drop policy if exists transcript_aliases_delete on public.transcript_aliases;
create policy transcript_aliases_delete on public.transcript_aliases
for delete to authenticated
using ((select public.auth_role()) = 'system_admin');

-- ---- transcript_source_audit_log ------------------------------

drop policy if exists transcript_source_audit_log_select on public.transcript_source_audit_log;
create policy transcript_source_audit_log_select on public.transcript_source_audit_log
for select to authenticated
using ((select public.auth_role()) = 'system_admin');
