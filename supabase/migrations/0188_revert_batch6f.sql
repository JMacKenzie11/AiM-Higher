-- =============================================================
-- Migration 0188: revert F8 batch 6f.
--
-- NOT APPLIED. This file exists so that reverting 0187 is a command
-- rather than a writing exercise performed under pressure, and it is
-- deliberately written BEFORE 0187 goes to the fleet.
--
-- 0187 rewrote eleven policies on the identity tables. If one of them
-- is wrong the blast radius is every page that reads profiles, on
-- every instance, at once. Two things make that recoverable rather
-- than a wedge, and both were checked:
--
--   auth_profile(), auth_role(), auth_company_id() and
--   auth_profile_status() are SECURITY DEFINER running as postgres
--   with BYPASSRLS, so a broken policy ON profiles does not affect
--   session or role resolution.
--
--   migrate:instances connects as postgres.<ref> through the session
--   pooler - the postgres role, which holds BYPASSRLS - so no policy
--   can lock the migration runner out of repairing it.
--
-- THE TEXTS BELOW ARE NOT HAND-WRITTEN. Each was read out of
-- pg_policies as deployed at 0186, before 0187 existed anywhere but a
-- branch, and the pair was rehearsed on the dev clone: 0187 applied,
-- then 0188, then every policy's rendered text compared against the
-- capture. Byte-identical, inside a transaction that rolled back.
--
-- The precedent for a forward revert rather than a down-migration is
-- 0171/0172, the phase 4 probe pair: one complete expand-and-contract
-- cycle run deliberately so the procedure is proven rather than
-- assumed.
--
-- To use: npm run migrate:instances -- --dry-run, then the apply, the
-- same way every other migration goes out.
-- =============================================================

drop policy if exists company_feature_events_select on public.company_feature_events;
create policy company_feature_events_select on public.company_feature_events
for select to authenticated
using (
  (EXISTS ( SELECT 1
   FROM auth_profile() ap(uid, company_id, role)
  WHERE (ap.role = 'system_admin'::text)))
);

drop policy if exists guide_assignments_delete on public.guide_assignments;
create policy guide_assignments_delete on public.guide_assignments
for delete to authenticated
using (
  (EXISTS ( SELECT 1
   FROM auth_profile() ap(uid, company_id, role)
  WHERE (ap.role = 'system_admin'::text)))
);

drop policy if exists guide_assignments_insert on public.guide_assignments;
create policy guide_assignments_insert on public.guide_assignments
for insert to authenticated
with check (
  (EXISTS ( SELECT 1
   FROM auth_profile() ap(uid, company_id, role)
  WHERE (ap.role = 'system_admin'::text)))
);

drop policy if exists guide_assignments_select on public.guide_assignments;
create policy guide_assignments_select on public.guide_assignments
for select to authenticated
using (
  (EXISTS ( SELECT 1
   FROM auth_profile() ap(uid, company_id, role)
  WHERE ((ap.role = 'system_admin'::text) OR (ap.uid = guide_assignments.guide_id))))
);

drop policy if exists oauth_credentials_select on public.oauth_credentials;
create policy oauth_credentials_select on public.oauth_credentials
for select to authenticated
using (
  (EXISTS ( SELECT 1
   FROM auth_profile() ap(uid, company_id, role)
  WHERE (ap.role = 'system_admin'::text)))
);

drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles
for delete to authenticated
using (
  (EXISTS ( SELECT 1
   FROM auth_profile() ap(uid, company_id, role)
  WHERE ((ap.role = 'system_admin'::text) OR ((ap.role = 'company_admin'::text) AND (ap.company_id IS NOT NULL) AND (ap.company_id = profiles.company_id) AND (ap.uid <> profiles.id)))))
);

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
for insert to authenticated
with check (
  (EXISTS ( SELECT 1
   FROM auth_profile() ap(uid, company_id, role)
  WHERE ((ap.role = 'system_admin'::text) OR ((ap.role = 'company_admin'::text) AND (ap.company_id IS NOT NULL) AND (ap.company_id = profiles.company_id) AND (profiles.role = ANY (ARRAY['company_admin'::text, 'team_member'::text]))))))
);

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
for select to authenticated
using (
  (EXISTS ( SELECT 1
   FROM auth_profile() ap(uid, company_id, role)
  WHERE ((ap.role = 'system_admin'::text) OR ((ap.company_id IS NOT NULL) AND (ap.company_id = profiles.company_id)) OR (ap.uid = profiles.id))))
);

drop policy if exists profiles_update_company_admin on public.profiles;
create policy profiles_update_company_admin on public.profiles
for update to authenticated
using (
  (EXISTS ( SELECT 1
   FROM auth_profile() ap(uid, company_id, role)
  WHERE ((ap.role = 'company_admin'::text) AND (ap.company_id IS NOT NULL) AND (ap.company_id = profiles.company_id) AND (ap.uid <> profiles.id))))
)
with check (
  (EXISTS ( SELECT 1
   FROM auth_profile() ap(uid, company_id, role)
  WHERE ((ap.role = 'company_admin'::text) AND (ap.company_id IS NOT NULL) AND (ap.company_id = profiles.company_id) AND (ap.uid <> profiles.id) AND (profiles.role = ANY (ARRAY['company_admin'::text, 'team_member'::text])))))
);

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
for update to authenticated
using (
  (id = auth.uid())
)
with check (
  ((id = auth.uid()) AND (role = ( SELECT ap.role
   FROM auth_profile() ap(uid, company_id, role))) AND (NOT (company_id IS DISTINCT FROM ( SELECT ap.company_id
   FROM auth_profile() ap(uid, company_id, role)))) AND (status = ( SELECT auth_profile_status() AS auth_profile_status)))
);

drop policy if exists profiles_update_system_admin on public.profiles;
create policy profiles_update_system_admin on public.profiles
for update to authenticated
using (
  (EXISTS ( SELECT 1
   FROM auth_profile() ap(uid, company_id, role)
  WHERE (ap.role = 'system_admin'::text)))
)
with check (
  (EXISTS ( SELECT 1
   FROM auth_profile() ap(uid, company_id, role)
  WHERE (ap.role = 'system_admin'::text)))
);
