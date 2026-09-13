-- =============================================================
-- Migration 0184: F8 batch 6c — strengths.
--
-- Sixteen policies across strengths_assessments, strengths_items,
-- strengths_narrative_messages, strengths_responses,
-- strengths_results, strengths_team_evaluations,
-- strengths_team_insights, strengths_team_members, strengths_teams
-- and strengths_teams. The _guide policies are untouched, as are the
-- four non-guide policies that never called auth_profile().
--
-- user_strengths IS DEFERRED, NOT DONE. Its policies put the helper
-- inside a CORRELATED exists - correlated on user_strengths.user_id -
-- and a scalar subquery in there is evaluated per row whatever it is
-- wrapped in. The naive hoist left auth_profile at loops=4 on a
-- four-row table, and a restructure that lifted the two caller-only
-- branches out of the exists made it WORSE, loops=13 and SubPlans 4
-- to 8. Measured both ways rather than argued. It needs a shape this
-- series has not needed yet, so it gets its own PR rather than a
-- rushed predicate here. Its four policies are untouched and stay on
-- the per-row form for now.
--
-- THESE ARE THE LONGEST PREDICATES IN THE SCHEMA and they were
-- transcribed mechanically rather than retyped: each one was read
-- out of pg_policies, the auth_profile() blocks replaced by exact
-- match, and the result asserted to contain no auth_profile() before
-- it was written here. Retyping twenty nested predicates by hand is
-- how a stray OR gets in.
--
-- company_has_feature IS LEFT ALONE, with one exception. It is the
-- strengths entitlement gate, it takes a per-row company_id in nine
-- of these ten tables, and a per-row argument cannot be hoisted -
-- same as is_guide_for. The exception is strengths_items, where the
-- argument is the CALLER's company rather than the row's:
--
--   before  exists (select 1 from auth_profile() ap
--            where ap.company_id is null
--               or company_has_feature(ap.company_id, 'strengths'))
--   after   (select public.auth_company_id()) is null
--           or company_has_feature((select public.auth_company_id()), 'strengths')
--
-- strengths_items is the shared item bank: every caller sees the same
-- rows, so the whole predicate depends only on who is asking and
-- hoists completely.
--
-- THE OWNER RULE HERE IS user_id = auth.uid(), and it appears on
-- assessments, responses, narrative messages, results and
-- user_strengths: a person may always reach their own assessment and
-- their own strengths. Transcribed as (select auth.uid()) and probed.
--
-- Form D throughout. Every `is not null` guard stays where it is.
-- =============================================================

-- ---- strengths_assessments -----------------------------

drop policy if exists strengths_assessments_insert on public.strengths_assessments;
create policy strengths_assessments_insert on public.strengths_assessments
for insert to authenticated
with check (
  ((user_id = (select auth.uid())) AND (((company_id IS NOT NULL) AND company_has_feature(company_id, 'strengths'::text)) OR ((company_id IS NULL) AND ((select public.auth_role()) = 'system_admin'))))
);

drop policy if exists strengths_assessments_select on public.strengths_assessments;
create policy strengths_assessments_select on public.strengths_assessments
for select to authenticated
using (
  (((company_id IS NOT NULL) AND company_has_feature(company_id, 'strengths'::text) AND ((user_id = (select auth.uid())) OR ((select public.auth_role()) = 'system_admin' or ((select public.auth_role()) = 'company_admin' and (select public.auth_company_id()) = strengths_assessments.company_id)))) OR ((company_id IS NULL) AND ((user_id = (select auth.uid())) OR ((select public.auth_role()) = 'system_admin'))))
);

-- ---- strengths_items -----------------------------------

drop policy if exists strengths_items_select on public.strengths_items;
create policy strengths_items_select on public.strengths_items
for select to authenticated
using (
  -- The `auth_role() is not null` half is NOT cosmetic and is not in
  -- the original text. It is what the original EXISTS was doing.
  --
  -- Before: exists (select 1 from auth_profile() ap where
  --                 ap.company_id is null or company_has_feature(...))
  -- A caller with no profile row makes auth_profile() return NO ROWS,
  -- so EXISTS is false and they are denied.
  --
  -- Hoisted naively, auth_company_id() returns NULL for that same
  -- caller, `NULL is null` is TRUE, and a deleted user could read the
  -- whole item bank. The harness's deleted-user case caught it on the
  -- first run: "a caller with no profile row can read this table".
  -- That is hazard 2 - NULL is not false once the expression is
  -- composed - in the one place this series could have introduced it.
  --
  -- auth_role() returns NULL for a caller with no profile, so testing
  -- it restores exactly the row that EXISTS was asking about.
  (select public.auth_role()) is not null
  and (
    (select public.auth_company_id()) is null
    or public.company_has_feature((select public.auth_company_id()), 'strengths')
  )
);

-- ---- strengths_narrative_messages ----------------------

drop policy if exists strengths_narrative_select on public.strengths_narrative_messages;
create policy strengths_narrative_select on public.strengths_narrative_messages
for select to authenticated
using (
  (EXISTS ( SELECT 1 FROM strengths_assessments a WHERE ((a.id = strengths_narrative_messages.assessment_id) AND (((a.company_id IS NOT NULL) AND company_has_feature(a.company_id, 'strengths'::text)) OR (a.company_id IS NULL)) AND ((a.user_id = (select auth.uid())) OR ((select public.auth_role()) = 'system_admin' or ((select public.auth_role()) = 'company_admin' and a.company_id is not null and (select public.auth_company_id()) = a.company_id))))))
);

-- ---- strengths_responses -------------------------------

drop policy if exists strengths_responses_select on public.strengths_responses;
create policy strengths_responses_select on public.strengths_responses
for select to authenticated
using (
  (EXISTS ( SELECT 1 FROM strengths_assessments a WHERE ((a.id = strengths_responses.assessment_id) AND (((a.company_id IS NOT NULL) AND company_has_feature(a.company_id, 'strengths'::text)) OR (a.company_id IS NULL)) AND ((a.user_id = (select auth.uid())) OR ((select public.auth_role()) = 'system_admin' or ((select public.auth_role()) = 'company_admin' and a.company_id is not null and (select public.auth_company_id()) = a.company_id))))))
);

-- ---- strengths_results ---------------------------------

drop policy if exists strengths_results_select on public.strengths_results;
create policy strengths_results_select on public.strengths_results
for select to authenticated
using (
  (EXISTS ( SELECT 1 FROM strengths_assessments a WHERE ((a.id = strengths_results.assessment_id) AND (((a.company_id IS NOT NULL) AND company_has_feature(a.company_id, 'strengths'::text)) OR (a.company_id IS NULL)) AND ((a.user_id = (select auth.uid())) OR ((select public.auth_role()) = 'system_admin' or ((select public.auth_role()) = 'company_admin' and a.company_id is not null and (select public.auth_company_id()) = a.company_id))))))
);

-- ---- strengths_team_evaluations ------------------------

drop policy if exists strengths_team_evaluations_select on public.strengths_team_evaluations;
create policy strengths_team_evaluations_select on public.strengths_team_evaluations
for select to authenticated
using (
  (EXISTS ( SELECT 1 FROM strengths_teams t WHERE ((t.id = strengths_team_evaluations.team_id) AND company_has_feature(t.company_id, 'strengths'::text) AND ((select public.auth_role()) = 'system_admin' or ((select public.auth_role()) = 'company_admin' and (select public.auth_company_id()) = t.company_id)))))
);

-- ---- strengths_team_insights ---------------------------

drop policy if exists strengths_team_insights_select on public.strengths_team_insights;
create policy strengths_team_insights_select on public.strengths_team_insights
for select to authenticated
using (
  (company_has_feature(company_id, 'strengths'::text) AND ((select public.auth_role()) = 'system_admin' or ((select public.auth_role()) = 'company_admin' and (select public.auth_company_id()) = strengths_team_insights.company_id)))
);

-- ---- strengths_team_members ----------------------------

drop policy if exists strengths_team_members_delete on public.strengths_team_members;
create policy strengths_team_members_delete on public.strengths_team_members
for delete to authenticated
using (
  (EXISTS ( SELECT 1 FROM strengths_teams t WHERE ((t.id = strengths_team_members.team_id) AND ((select public.auth_role()) = 'system_admin' or ((select public.auth_role()) = 'company_admin' and (select public.auth_company_id()) = t.company_id)))))
);

drop policy if exists strengths_team_members_insert on public.strengths_team_members;
create policy strengths_team_members_insert on public.strengths_team_members
for insert to authenticated
with check (
  (EXISTS ( SELECT 1 FROM strengths_teams t WHERE ((t.id = strengths_team_members.team_id) AND ((select public.auth_role()) = 'system_admin' or ((select public.auth_role()) = 'company_admin' and (select public.auth_company_id()) = t.company_id)))))
);

drop policy if exists strengths_team_members_select on public.strengths_team_members;
create policy strengths_team_members_select on public.strengths_team_members
for select to authenticated
using (
  (EXISTS ( SELECT 1 FROM strengths_teams t WHERE ((t.id = strengths_team_members.team_id) AND company_has_feature(t.company_id, 'strengths'::text) AND ((select public.auth_role()) = 'system_admin' or ((select public.auth_role()) = 'company_admin' and (select public.auth_company_id()) = t.company_id)))))
);

drop policy if exists strengths_team_members_update on public.strengths_team_members;
create policy strengths_team_members_update on public.strengths_team_members
for update to authenticated
using (
  (EXISTS ( SELECT 1 FROM strengths_teams t WHERE ((t.id = strengths_team_members.team_id) AND ((select public.auth_role()) = 'system_admin' or ((select public.auth_role()) = 'company_admin' and (select public.auth_company_id()) = t.company_id)))))
)
with check (
  (EXISTS ( SELECT 1 FROM strengths_teams t WHERE ((t.id = strengths_team_members.team_id) AND ((select public.auth_role()) = 'system_admin' or ((select public.auth_role()) = 'company_admin' and (select public.auth_company_id()) = t.company_id)))))
);

-- ---- strengths_teams -----------------------------------

drop policy if exists strengths_teams_delete on public.strengths_teams;
create policy strengths_teams_delete on public.strengths_teams
for delete to authenticated
using (
  ((select public.auth_role()) = 'system_admin' or ((select public.auth_role()) = 'company_admin' and (select public.auth_company_id()) = strengths_teams.company_id))
);

drop policy if exists strengths_teams_insert on public.strengths_teams;
create policy strengths_teams_insert on public.strengths_teams
for insert to authenticated
with check (
  (company_has_feature(company_id, 'strengths'::text) AND ((select public.auth_role()) = 'system_admin' or ((select public.auth_role()) = 'company_admin' and (select public.auth_company_id()) = strengths_teams.company_id)))
);

drop policy if exists strengths_teams_select on public.strengths_teams;
create policy strengths_teams_select on public.strengths_teams
for select to authenticated
using (
  (company_has_feature(company_id, 'strengths'::text) AND ((select public.auth_role()) = 'system_admin' or ((select public.auth_role()) = 'company_admin' and (select public.auth_company_id()) = strengths_teams.company_id)))
);

drop policy if exists strengths_teams_update on public.strengths_teams;
create policy strengths_teams_update on public.strengths_teams
for update to authenticated
using (
  ((select public.auth_role()) = 'system_admin' or ((select public.auth_role()) = 'company_admin' and (select public.auth_company_id()) = strengths_teams.company_id))
)
with check (
  ((select public.auth_role()) = 'system_admin' or ((select public.auth_role()) = 'company_admin' and (select public.auth_company_id()) = strengths_teams.company_id))
);
