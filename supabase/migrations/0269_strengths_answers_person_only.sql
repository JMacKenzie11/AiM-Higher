-- 0269: a person's raw strengths answers and assessment conversation
-- are read by that person, and by a system admin for support. Nobody
-- else.
--
-- WHY. Jason, 2026-10-13: "only the person can read their own raw
-- answers. Company admins and portfolio admins cannot. System admins
-- keep read access for support only." 0267 removed the portfolio admin
-- reads. The company admin of the person's own company still read both
-- tables through the select rules 0184 hoisted, which is what this
-- closes.
--
-- WHAT. strengths_responses_select and strengths_narrative_select are
-- recreated without the company admin clause. Everything else in them
-- is unchanged: the strengths feature gate, and a personal assessment
-- (no company) readable by its person and a system admin. No guide or
-- portfolio rule reads either table. Results, profiles and the team
-- pages, which 0253 opened to the company, are untouched.
--
-- No app path reads either table as anyone but the person: the
-- assessment flow and the two strengths routes check that the caller
-- owns the assessment (src/app/api/strengths/narrative/route.ts,
-- generate-results/route.ts).

-- Roles: read only. The person (a.user_id = auth.uid()), and
-- system_admin.
drop policy if exists strengths_responses_select on public.strengths_responses;
create policy strengths_responses_select on public.strengths_responses
for select to authenticated
using (
  exists (
    select 1 from public.strengths_assessments a
     where a.id = strengths_responses.assessment_id
       and ((a.company_id is not null and public.company_has_feature(a.company_id, 'strengths'))
            or a.company_id is null)
       and (a.user_id = (select auth.uid())
            or (select public.auth_role()) = 'system_admin')
  )
);
comment on policy strengths_responses_select on public.strengths_responses is
  'Admits: the person, and system_admin for support (0269). Not their company admin, guide or portfolio admin.';

-- Roles: read only. The person (a.user_id = auth.uid()), and
-- system_admin.
drop policy if exists strengths_narrative_select on public.strengths_narrative_messages;
create policy strengths_narrative_select on public.strengths_narrative_messages
for select to authenticated
using (
  exists (
    select 1 from public.strengths_assessments a
     where a.id = strengths_narrative_messages.assessment_id
       and ((a.company_id is not null and public.company_has_feature(a.company_id, 'strengths'))
            or a.company_id is null)
       and (a.user_id = (select auth.uid())
            or (select public.auth_role()) = 'system_admin')
  )
);
comment on policy strengths_narrative_select on public.strengths_narrative_messages is
  'Admits: the person, and system_admin for support (0269). Not their company admin, guide or portfolio admin.';
