-- =============================================================
-- Migration 0246 — a portfolio admin keeps what any owner can do with
-- its own work
--
-- 0245 took an assigned portfolio admin's content writes away. It had
-- been closing out its own commitments through them: every owner rule
-- below also requires `auth_company_id() = company_id`, and a portfolio
-- admin's company_id is null by constraint
-- (profiles_portfolio_admin_has_no_company). 0207 said so when it
-- promoted Steve Kessen and Sean Wenger: without the reach, their
-- commitments would be "owned by people who could not resolve them".
--
-- Checked read only, 2026-09-29: on PromiseOne, the three portfolio
-- admins own 14 commitments and 3 priorities, all in Promise One.
--
-- So each owner rule admits the owner when they are a member of the
-- company OR assigned to it (is_assigned_to_company: a guide or
-- portfolio assignment). Only rows they own, or sponsor: an owner
-- rule's WITH CHECK keeps owner_id on themselves, so they cannot hand
-- a row to somebody else or take one that is not theirs. Everything
-- else stays as 0245 left it. Jason, 2026-09-29.
--
-- Admits, on every rule below: the row's owner (sponsor, for a focus
-- area) who is a member of the company or assigned to it. Never
-- anybody else's row.
--
-- Unchanged, and already owner-only with no company condition:
-- commitments_delete_owner (an open one they own) and
-- commitment_occurrences_write_owner.
-- =============================================================

-- Mark kept or missed, reschedule, park, edit: the owner's own commitment.
alter policy "commitments_update_owner" on public."commitments"
  using ((owner_id = ( SELECT auth.uid() AS uid)) AND ((( SELECT auth_company_id() AS auth_company_id) = company_id) OR public.is_assigned_to_company(( SELECT auth.uid() AS uid), company_id)))
  with check (owner_id = ( SELECT auth.uid() AS uid));
comment on policy "commitments_update_owner" on public."commitments" is
  'Admits: the owner, a member of the company or assigned to it (0246). Their own rows only.';

-- Add a commitment of their own.
alter policy "commitments_insert_owner" on public."commitments"
  with check ((owner_id = ( SELECT auth.uid() AS uid)) AND ((( SELECT auth_company_id() AS auth_company_id) = company_id) OR public.is_assigned_to_company(( SELECT auth.uid() AS uid), company_id)));
comment on policy "commitments_insert_owner" on public."commitments" is
  'Admits: the owner, a member of the company or assigned to it (0246). Their own rows only.';

-- Update the progress and status of a priority they own.
alter policy "priorities_update_owner" on public."priorities"
  using ((owner_id = ( SELECT auth.uid() AS uid)) AND ((( SELECT auth_company_id() AS auth_company_id) = company_id) OR public.is_assigned_to_company(( SELECT auth.uid() AS uid), company_id)))
  with check (owner_id = ( SELECT auth.uid() AS uid));
comment on policy "priorities_update_owner" on public."priorities" is
  'Admits: the owner, a member of the company or assigned to it (0246). Their own rows only.';

-- An annual goal they own.
alter policy "annual_goals_update_owner" on public."annual_goals"
  using ((owner_id = ( SELECT auth.uid() AS uid)) AND ((( SELECT auth_company_id() AS auth_company_id) = company_id) OR public.is_assigned_to_company(( SELECT auth.uid() AS uid), company_id)))
  with check (owner_id = ( SELECT auth.uid() AS uid));
comment on policy "annual_goals_update_owner" on public."annual_goals" is
  'Admits: the owner, a member of the company or assigned to it (0246). Their own rows only.';

-- A focus area they sponsor.
alter policy "sfa_update_owner" on public."strategic_focus_areas"
  using ((sponsor_id = ( SELECT auth.uid() AS uid)) AND ((( SELECT auth_company_id() AS auth_company_id) = company_id) OR public.is_assigned_to_company(( SELECT auth.uid() AS uid), company_id)))
  with check (sponsor_id = ( SELECT auth.uid() AS uid));
comment on policy "sfa_update_owner" on public."strategic_focus_areas" is
  'Admits: the sponsor, a member of the company or assigned to it (0246). Their own rows only.';
