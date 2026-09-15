-- Where the application takes a cross-tenant operator when they open it.
--
-- Step 3 of the sequence in product-spec §1a, and deliberately NOT
-- `profiles.company_id`.
--
-- ---- WHY A NEW COLUMN, WHICH IS THE WHOLE POINT ----------------
--
-- The original design put home in `company_id`. The policy audit of
-- 2026-09-15 ran before that was built and found what it would have
-- cost: `auth_company_id()` reads `company_id`, and 142 policies in
-- this schema decide access by comparing it to a row's company. Ten
-- of those discriminate on nothing else, and three grant WRITES on
-- company membership alone --
--
--   issues.issues_insert_member
--   commitments.commitments_claim_unassigned
--
-- -- so a portfolio admin holding a home company would have been able
-- to create issues and claim unassigned commitments there while
-- holding no assignment at all. Those policies are correct for the
-- members they were written for. The design was wrong: rights would
-- have come from HOME rather than from an ASSIGNMENT, contradicting
-- the decision in its own first sentence.
--
-- So home lives here, `auth_company_id()` never returns it, and all
-- 142 policies go on meaning exactly what they meant yesterday.
-- `profiles_portfolio_admin_has_no_company` stays, still doing its
-- job.
--
-- ---- WHAT THIS COLUMN GRANTS: NOTHING --------------------------
--
-- It is read by the scope resolver and by nothing else. No policy
-- references it, no helper returns it, and the harness asserts that a
-- portfolio admin with a home and no assignment still writes nothing
-- in that company. A person may set their own, because
-- profiles_update_self already pins role, company_id and status and
-- this is a landing preference rather than a permission.

alter table public.profiles
  add column if not exists home_company_id uuid
  references public.companies(id) on delete set null;

-- For the FK's sake rather than the resolver's: the resolver reads
-- one profile by primary key, but deleting a company scans referencing
-- rows and an unindexed FK makes that a sequential scan of profiles.
create index if not exists profiles_home_company_idx
  on public.profiles (home_company_id);

comment on column public.profiles.home_company_id is
  'Where the application takes this person when they open it. A '
  'landing preference, never a permission: auth_company_id() does not '
  'return it and no policy reads it. Rights come from '
  'portfolio_assignments and guide_assignments. Null for everyone '
  'whose company_id already answers the question.';
