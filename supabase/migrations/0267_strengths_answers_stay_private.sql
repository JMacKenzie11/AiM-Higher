-- 0267: a portfolio admin no longer reads a person's raw strengths
-- answers or their assessment conversation.
--
-- WHY. 0253 (decisions 6 and 8) opened a person's strengths profile
-- and results to their company, and kept two things private:
-- strengths_responses (their raw answers) and
-- strengths_narrative_messages (their assessment conversation), "closer
-- to an Aimee conversation than to a result". 0191 had already given
-- every portfolio admin a read of both, across every company on the
-- instance, with no assignment needed, and 0253 did not take it back.
-- Found while scoping the outside assistant work; Jason, 2026-10-13:
-- portfolio admins must not read raw strengths answers, matching 0253.
--
-- WHAT. The two portfolio read rules from 0191 are dropped. Nothing
-- replaces them. A portfolio admin keeps what 0253 opened: profiles,
-- results and the team pages (strengths_assessments, strengths_results,
-- strengths_teams and the rest), through their own _select_portfolio
-- rules, which are unchanged.
--
-- WHO STILL READS THEM, unchanged here: the person, a system admin, and
-- the company admin of the person's own company (strengths_responses_select
-- and strengths_narrative_select, 0184). No app path reads either table
-- as a portfolio admin: the only readers are the person's own
-- assessment flow (src/app/(app)/strengths/assessment,
-- src/app/api/strengths).
--
-- Roles: read only, and only removed.

drop policy if exists strengths_responses_select_portfolio on public.strengths_responses;
drop policy if exists strengths_narrative_messages_select_portfolio on public.strengths_narrative_messages;
