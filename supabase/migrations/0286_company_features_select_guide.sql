-- 0286: an assigned guide reads its companies' features.
--
-- WHY. UI audit X-01, 2026-10-16, the one Blocker. company_features has
-- two SELECT policies: company_features_select (0175) admits a
-- system_admin and the company's own members, and
-- company_features_select_portfolio (0191) admits a portfolio_admin.
-- An aims_guide has a NULL company_id, so it falls outside both, and
-- 0111 skipped this table on purpose when it gave guides their mirror
-- policies ("feature toggles stay a platform-level decision"). That
-- kept WRITES with the platform, which is right, and took READS away
-- with them, which nobody meant.
--
-- getCompanyFeatures() reads the table with the caller's own session,
-- so for a guide it returns no rows, and every companyHasFeature()
-- gate is false. Seen as the E2E guide on E2E Fixture Co, a company
-- with every feature on:
--
--   the sidebar has no Workspace, Strengths or Classroom links
--   every role description is a 404
--   every Classroom URL redirects to /dashboard
--   a meeting says automatic commitment tracking is off, and hides
--   the facilitation review
--
-- A guide is treated as the company's admin on the companies it is
-- assigned to, and a company admin reads these rows as a member.
--
-- WHAT. One SELECT policy, company_features_select_guide, the same
-- shape as the other *_select_guide mirrors from 0111: is_guide_for()
-- on the row's company. Since 0199 that also admits an assigned
-- portfolio_admin, which already reads every row through
-- company_features_select_portfolio, so it widens nothing for that
-- role. It is a READ; CLAUDE.md's ban on is_guide_for() is for write
-- rules.
--
-- Writes are unchanged: insert, update and delete stay with a
-- system_admin (0175) and a portfolio_admin (0192). A guide still
-- cannot switch a feature on or off.

-- Roles: aims_guide (assigned to the row's company); also an assigned
-- portfolio_admin, through is_guide_for(), who already reads every row.
-- SELECT only.
drop policy if exists company_features_select_guide on public.company_features;
create policy company_features_select_guide on public.company_features
for select to authenticated
using (public.is_guide_for(public.company_features.company_id));
