-- Giving yourself a company is an administrative action, and the
-- record says so.
--
-- Decision 2 (spec §1a) settled that a portfolio admin may assign
-- themselves any company on the instance, and was explicit about the
-- price: "What the software owes is that the arrangement is LEGIBLE:
-- recorded, visible, and never silent."
--
-- The Company access card shipped it visible and not recorded. A
-- portfolio admin enabling a feature leaves a row here; the same
-- person granting themselves company-admin rights over a whole
-- company left nothing. The state was the only evidence, which says
-- what is true now and never who changed it or when.
--
-- AND IT WOULD HAVE FAILED SILENTLY. recordPortfolioEvent is
-- fire-and-report by design — the audit write must not be able to
-- fail the thing it is recording — so an action absent from this
-- CHECK inserts nothing and says nothing. That is failure mode E14,
-- written up this morning about coach_token_usage.purpose, where
-- `memory` sat in the TypeScript union and not in the constraint and
-- every insert vanished for the life of the feature. Same shape, one
-- table over. A source-level test now holds this list against
-- PortfolioAction the way the other one holds CoachUsagePurpose.
alter table public.portfolio_admin_events
  drop constraint if exists portfolio_admin_events_action_check;

alter table public.portfolio_admin_events
  add constraint portfolio_admin_events_action_check
  check (action in (
    'scoped_in',
    'company_created',
    'company_settings_changed',
    'company_archived',
    'company_unarchived',
    'feature_enabled',
    'feature_disabled',
    'user_invited',
    'company_access_granted',
    'company_access_revoked'
  ));
