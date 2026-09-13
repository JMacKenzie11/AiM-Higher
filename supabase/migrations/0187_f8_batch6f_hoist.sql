-- =============================================================
-- Migration 0187: F8 batch 6f — identity and entitlement. The last
-- batch.
--
-- profiles, guide_assignments, oauth_credentials,
-- company_feature_events. Eleven policies; the _guide policies are
-- untouched.
--
-- ============================================================
-- CIRCULARITY: WHY A POLICY ON profiles MAY CALL auth_role()
-- ============================================================
--
-- profiles is the table auth_profile() reads. Putting
-- (select public.auth_role()) into a policy ON profiles looks like it
-- must recurse: evaluating the policy calls the helper, the helper
-- reads profiles, which evaluates the policy.
--
-- It does not, and the reason is three facts that were checked rather
-- than assumed:
--
--   auth_profile, auth_role, auth_company_id, auth_profile_status
--     are all SECURITY DEFINER, owned by postgres, search_path pinned
--   postgres has rolbypassrls = true
--   profiles has relforcerowsecurity = true
--
-- SECURITY DEFINER makes current_user postgres inside the helper.
-- postgres holds BYPASSRLS, so the read of profiles inside the helper
-- evaluates no policy at all, and the loop never closes. The third
-- fact is why the first two matter: profiles FORCES row security, so
-- being the table's owner would NOT be enough on its own. BYPASSRLS
-- is doing the work.
--
-- DEMONSTRATED, on scratch tables inside rolled-back transactions,
-- because "it does not recurse" is exactly the kind of claim this
-- project has learned to measure:
--
--   policy selects from its own table (inlined)
--     -> 42P17: infinite recursion detected in policy for relation
--   same lookup via a SECURITY DEFINER helper owned by postgres
--     -> 1 row
--   the same helper as SECURITY INVOKER
--     -> 54001: stack depth limit exceeded
--
-- WHAT WOULD BREAK IT, each a single plausible change:
--   1. any of those four helpers becoming SECURITY INVOKER (case 3)
--   2. BYPASSRLS revoked from postgres — FORCE RLS means ownership
--      alone will not save it
--   3. someone inlining the lookup into a policy instead of calling
--      the helper (case 1), which is the shape this migration would
--      have produced if "hoist" had been read as "write a subquery"
--
-- This batch therefore makes profiles MORE dependent on a property of
-- the helpers, not less. That is the trade: eleven policies stop
-- calling a set-returning function per row, and in exchange the
-- security of the identity table rests on four functions staying
-- SECURITY DEFINER. Written down here because a future reader
-- flipping one of them needs to meet this paragraph first.
--
-- ============================================================
-- THE LAST `IS DISTINCT FROM` IN THE SCHEMA STAYS
-- ============================================================
--
-- profiles_update_self compares the NEW row against the CALLER's own
-- current values, to allow a person to edit themselves without
-- changing their own role, company or status. The company comparison
-- is NULL-safe on purpose:
--
--   company_id is not distinct from (select public.auth_company_id())
--
-- A system_admin and an aims_guide both have company_id NULL, and
-- plain `=` would deny them their own profile edit. This is the
-- policy the static check allowlists, and it is allowlisted because
-- it is NOT a tenant predicate: both sides describe the same person,
-- so NULL matching NULL is the correct answer rather than the
-- dangerous one. Hazard 1 is about a CALLER with no company meeting a
-- ROW with no company. Here the caller and the row are the same
-- profile.
--
-- TWO HAZARD 3 SHAPES ARE REMOVED. The same WITH CHECK compared role
-- and company against BARE scalar subqueries over auth_profile(),
-- which is the form that raises "more than one row returned by a
-- subquery used as an expression" the day the helper's WHERE can
-- match twice. That is now the third instance the series has found
-- and the last one in the schema.
--
-- Every `is not null` guard and every `ap.uid <> profiles.id`
-- self-exclusion is transcribed exactly. A company_admin still cannot
-- edit or delete themselves through the company_admin policy, and
-- still cannot mint a system_admin.
-- =============================================================

-- ---- company_feature_events -----------------------------------

drop policy if exists company_feature_events_select on public.company_feature_events;
create policy company_feature_events_select on public.company_feature_events
for select to authenticated
using ((select public.auth_role()) = 'system_admin');

-- ---- oauth_credentials ----------------------------------------

drop policy if exists oauth_credentials_select on public.oauth_credentials;
create policy oauth_credentials_select on public.oauth_credentials
for select to authenticated
using ((select public.auth_role()) = 'system_admin');

-- ---- guide_assignments ----------------------------------------

drop policy if exists guide_assignments_select on public.guide_assignments;
create policy guide_assignments_select on public.guide_assignments
for select to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (select auth.uid()) = public.guide_assignments.guide_id
);

drop policy if exists guide_assignments_insert on public.guide_assignments;
create policy guide_assignments_insert on public.guide_assignments
for insert to authenticated
with check ((select public.auth_role()) = 'system_admin');

drop policy if exists guide_assignments_delete on public.guide_assignments;
create policy guide_assignments_delete on public.guide_assignments
for delete to authenticated
using ((select public.auth_role()) = 'system_admin');

-- ---- profiles -------------------------------------------------

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
for select to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_company_id()) is not null
    and (select public.auth_company_id()) = public.profiles.company_id
  )
  or (select auth.uid()) = public.profiles.id
);

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
for insert to authenticated
with check (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) is not null
    and (select public.auth_company_id()) = public.profiles.company_id
    and public.profiles.role = any (array['company_admin', 'team_member'])
  )
);

drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles
for delete to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) is not null
    and (select public.auth_company_id()) = public.profiles.company_id
    and (select auth.uid()) <> public.profiles.id
  )
);

drop policy if exists profiles_update_system_admin on public.profiles;
create policy profiles_update_system_admin on public.profiles
for update to authenticated
using ((select public.auth_role()) = 'system_admin')
with check ((select public.auth_role()) = 'system_admin');

drop policy if exists profiles_update_company_admin on public.profiles;
create policy profiles_update_company_admin on public.profiles
for update to authenticated
using (
  (select public.auth_role()) = 'company_admin'
  and (select public.auth_company_id()) is not null
  and (select public.auth_company_id()) = public.profiles.company_id
  and (select auth.uid()) <> public.profiles.id
)
with check (
  (select public.auth_role()) = 'company_admin'
  and (select public.auth_company_id()) is not null
  and (select public.auth_company_id()) = public.profiles.company_id
  and (select auth.uid()) <> public.profiles.id
  and public.profiles.role = any (array['company_admin', 'team_member'])
);

-- The allowlisted IS DISTINCT FROM. See the header.
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
for update to authenticated
using (public.profiles.id = (select auth.uid()))
with check (
  public.profiles.id = (select auth.uid())
  and public.profiles.role = (select public.auth_role())
  and public.profiles.company_id is not distinct from (select public.auth_company_id())
  and public.profiles.status = (select public.auth_profile_status())
);
