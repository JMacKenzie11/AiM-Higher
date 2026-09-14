-- =============================================================
-- Migration 0190: the portfolio_admin role.
--
-- WHO THIS IS FOR. A PE operating partner who owns an instance's
-- portfolio. They need to see across every company on the instance
-- and to run the container around those companies (create one, set
-- its packaging, staff its first admin) without being able to touch
-- what the companies produce.
--
-- INSTANCE-WIDE BY CONSTRUCTION, NOT BY GRANT. There is no
-- portfolio_assignments table and there is deliberately not going to
-- be one. aims_guide has guide_assignments because a guide's
-- caseload is a subset that changes; a portfolio_admin's scope is
-- "this instance", which is already expressed by the fact that their
-- profile row lives in this database. A grant table would add a
-- second place for that to be true, and the failure mode of two
-- sources of truth is that one of them is stale.
--
-- The cost of that choice is auditability: with no per-company grant
-- there is no row to point at that says "they were allowed in here".
-- portfolio_admin_events below is the replacement, and the reason it
-- is in this migration rather than a later one.
--
-- THREE THINGS THIS FILE DOES:
--   1. admits the role to the two profiles CHECK constraints
--   2. adds is_portfolio_admin(), the form D predicate the read and
--      write policies are built from
--   3. creates portfolio_admin_events, the accountability layer
--
-- Reads land in 0191. Container writes land in 0192. Split because
-- the read surface is sixty policies of mechanical shape and the
-- write surface is nine policies that each need reading carefully,
-- and a reviewer should not have to find the second inside the first.
-- =============================================================

-- ---- 1. The role ---------------------------------------------
--
-- Two constraints, not one. profiles_role_check lists the roles that
-- exist; profiles_role_requires_company lists the ones that may have
-- no company. portfolio_admin belongs in both: it is a real role, and
-- like system_admin and aims_guide it has no home company, because
-- having one would make every `auth_company_id() = company_id`
-- predicate in the schema quietly true for one tenant.

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('system_admin', 'company_admin', 'team_member',
                  'aims_guide', 'portfolio_admin'));

alter table public.profiles
  drop constraint if exists profiles_role_requires_company;
alter table public.profiles add constraint profiles_role_requires_company
  check (
    role in ('system_admin', 'aims_guide', 'portfolio_admin')
    or company_id is not null
  );

-- And a third, which the other two do not imply.
--
-- The constraint above says a portfolio_admin MAY have no company. It
-- does not say they may not have one, and a portfolio_admin with a
-- company_id would be quietly wrong in two directions at once:
-- getEffectiveCompanyId returns profile.company_id before it looks at
-- anything else, so they would be pinned to that tenant and unable to
-- scope anywhere; and every `auth_company_id() = company_id`
-- predicate in the schema would become true for that one company,
-- giving them a second, narrower kind of access nobody designed.
--
-- Nothing in the app sets it, which is exactly why it belongs here: a
-- rule that only holds while the code is correct is not a rule.
alter table public.profiles
  drop constraint if exists profiles_portfolio_admin_has_no_company;
alter table public.profiles add constraint profiles_portfolio_admin_has_no_company
  check (role <> 'portfolio_admin' or company_id is null);

-- ---- 2. The predicate ----------------------------------------
--
-- WHY A HELPER RATHER THAN THE LITERAL. Sixty policies are about to
-- ask the same question. Written out, the role name appears sixty
-- times as a string inside a policy body, and the static check that
-- polices where portfolio_admin may WRITE has to parse those bodies
-- to find them. One named, greppable predicate makes both the
-- policies and the check say the same thing in the same words.
--
-- TAKES NO ARGUMENT, WHICH IS THE POINT. is_guide_for(company) takes
-- one because a guide's answer differs per row, and docs/f8-rls-hoist
-- .md records that it is therefore deliberately not hoisted. A
-- portfolio_admin's answer is the same for every row on the instance,
-- so `(select public.is_portfolio_admin())` is a scalar subquery with
-- no outer reference: Postgres evaluates it once as an InitPlan. That
-- is form D, and it is the whole reason this role can have
-- instance-wide read without the 374x cost the F8 series existed to
-- remove.
--
-- SECURITY DEFINER and a pinned search_path, matching auth_role().

create or replace function public.is_portfolio_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select public.auth_role()) = 'portfolio_admin', false)
$$;

comment on function public.is_portfolio_admin() is
  'True when the caller is a portfolio_admin. Argument-free so callers '
  'can wrap it as (select public.is_portfolio_admin()) and get an '
  'InitPlan rather than a per-row call. See docs/f8-rls-hoist.md.';

-- coalesce, not a bare comparison. auth_role() is NULL for a
-- service-role caller and for an authenticated user with no profile
-- row, and `NULL = 'portfolio_admin'` is NULL rather than false.
-- Hazard 2 in docs/failure-modes.md is that exact shape: a NULL that
-- is not false stops being a denial the moment it is composed into a
-- larger expression with OR. Returning a real false here means no
-- policy downstream has to remember.

-- ---- 3. The accountability layer -----------------------------

create table if not exists public.portfolio_admin_events (
  id uuid primary key default gen_random_uuid(),
  -- The profile that acted. NOT NULL: unlike the feature and settings
  -- logs, which record writes that provisioning and migrations also
  -- make, every row here is by definition a portfolio_admin doing
  -- something, and a row that cannot name them records nothing worth
  -- keeping.
  actor_id uuid not null references public.profiles(id) on delete restrict,
  -- on delete restrict, not set null and not cascade. Deleting the
  -- actor must not be able to erase or anonymise what they did; if
  -- somebody genuinely needs a portfolio_admin profile gone, the
  -- events are the thing that has to be dealt with deliberately
  -- first, rather than the thing that quietly disappears with them.
  action text not null check (action in (
    'scoped_in',
    'company_created',
    'company_settings_changed',
    'company_archived',
    'company_unarchived',
    'feature_enabled',
    'feature_disabled',
    'user_invited'
  )),
  -- The company acted on. Null only for an action that is not about
  -- one; every action in the list above is, so in practice this is
  -- always set. Left nullable rather than NOT NULL so an instance-
  -- level action added later does not need a migration to record.
  company_id uuid references public.companies(id) on delete set null,
  -- Free-form detail: which feature, which invitee, which setting.
  -- jsonb rather than columns because the shape differs per action
  -- and a column per action is a table that grows a column every time
  -- somebody adds a button.
  detail jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.portfolio_admin_events is
  'Append-only record of everything a portfolio_admin does. THIS IS '
  'THE ACCOUNTABILITY LAYER THAT REPLACES PER-COMPANY GRANTS: the '
  'role has instance-wide reach by construction rather than by a row '
  'in a grant table, so there is no assignment to inspect after the '
  'fact. What exists instead is this: every scope-in and every '
  'administrative write leaves a row naming the actor, the action, '
  'the company and the time. Written by the action layer. No UPDATE '
  'or DELETE policy exists for any role.';

create index if not exists portfolio_admin_events_actor_idx
  on public.portfolio_admin_events (actor_id, occurred_at desc);

create index if not exists portfolio_admin_events_company_idx
  on public.portfolio_admin_events (company_id, occurred_at desc);

alter table public.portfolio_admin_events enable row level security;

-- SELECT for system_admin and nobody else, including the actor. A
-- portfolio_admin reading their own trail is not a hole on its own,
-- but a log whose subject can enumerate it is a log whose subject
-- knows exactly what was and was not recorded. The audience for this
-- is the person who granted the role.
create policy portfolio_admin_events_select
on public.portfolio_admin_events
for select to authenticated
using ((select public.auth_role()) = 'system_admin');

-- INSERT for the actor, and ONLY as themselves.
--
-- Unlike company_feature_events and company_settings_events, this one
-- cannot be written by a trigger: "scoped in" is not a row change in
-- any table, and "invited a user" happens through the service-role
-- client where no trigger can tell a portfolio_admin apart from
-- provisioning. So the action layer writes it, and the policy
-- constrains what the action layer is able to say: you may write a
-- row about yourself, and only if you are the role this table is
-- about.
create policy portfolio_admin_events_insert
on public.portfolio_admin_events
for insert to authenticated
with check (
  (select public.is_portfolio_admin())
  and actor_id = (select auth.uid())
);

-- No UPDATE and no DELETE policy, for any role. Append-only is the
-- property; a row that can be edited afterwards is a claim, not a
-- record.

-- ---- Entitlement history for the role ------------------------
--
-- Extends 0173. A portfolio_admin manages packaging, so "was this
-- feature on in August?" is their question to answer. Company admins
-- stay without read, unchanged: 0173 set that out as billing-adjacent
-- history belonging to whoever administers the account rather than to
-- the tenant, and nothing here changes that reasoning.
--
-- A separate permissive policy rather than an edit to
-- company_feature_events_select. Expand-only: the existing policy is
-- untouched, so system_admin's access cannot be affected by a typo in
-- this one.
drop policy if exists company_feature_events_select_portfolio
  on public.company_feature_events;
create policy company_feature_events_select_portfolio
on public.company_feature_events
for select to authenticated
using ((select public.is_portfolio_admin()));
