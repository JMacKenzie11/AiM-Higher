-- =============================================================
-- Migration 0181: let the database enforce what the app already grants
-- on transcript sources, aliases and meeting routing.
--
-- This is a SEMANTIC change and deliberately not part of any F8
-- batch. Batches 1-5 moved how a predicate is evaluated and never who
-- is admitted. This changes who is admitted.
--
-- WHAT IS TRUE TODAY. src/lib/transcripts/actions.ts grants
-- system_admin, company_admin and aims_guide (transcriptSourcesAllowed
-- + isAdminForCompany) the right to connect, pause, resume and remove
-- transcript sources, to route and dismiss meetings, and to manage
-- aliases — all scoped per company by guardForSource, guardForMeeting,
-- guardForAlias and guardForCompany. Those guards are careful and
-- correct.
--
-- The database does not know any of it. Every one of those writes goes
-- through a service-role client, which never consults RLS, and the
-- policies admit system_admin only. Measured, not assumed, in the F8
-- batch 5 report:
--
--   company_admin pauses a transcript source    0 rows (system_admin: 1)
--   company_admin removes a transcript source   0 rows (system_admin: 1)
--   company_admin connects a folder             42501 violates RLS
--
-- So the app guard is the entire boundary. Failure mode E5.
--
-- THE GUIDE MIRRORS ALREADY EXIST. transcript_sources,
-- transcript_aliases and meetings all carry _guide write policies
-- using is_guide_for(company_id). It is the company_admin originals
-- they mirror that were never written — the inverse of the usual
-- drift, and why nobody noticed: a guide's writes would have worked
-- if anything had ever asked the database.
--
-- WHAT THIS ADDS. One company_admin policy per write the app already
-- grants, scoped exactly as the app scopes it:
--
--   the row's company_id is not null AND equals the caller's company
--
-- NULL company_id stays system_admin only, which is what
-- guardForCompany says in TypeScript: an unrouted meeting or a
-- shared-scope source has no owner yet, so no tenant admin may claim
-- it. `=` denies against NULL, so no extra guard is needed for that;
-- the `is not null` is written anyway, beside its siblings in 0180,
-- because a reader comparing the two should not have to reason about
-- three-valued logic to see they agree.
--
-- WITH CHECK pins the destination as well as the source: a
-- company_admin may route a meeting TO their own company and nowhere
-- else, so re-homing another tenant's transcript is refused by the
-- database and not only by the guard.
--
-- Form D throughout, against the policies F8 batch 5 left in final
-- shape.
-- =============================================================

-- ---- transcript_sources ---------------------------------------

drop policy if exists transcript_sources_insert_company_admin on public.transcript_sources;
create policy transcript_sources_insert_company_admin on public.transcript_sources
for insert to authenticated
with check (
  (select public.auth_role()) = 'company_admin'
  and public.transcript_sources.company_id is not null
  and (select public.auth_company_id()) = public.transcript_sources.company_id
);

drop policy if exists transcript_sources_update_company_admin on public.transcript_sources;
create policy transcript_sources_update_company_admin on public.transcript_sources
for update to authenticated
using (
  (select public.auth_role()) = 'company_admin'
  and public.transcript_sources.company_id is not null
  and (select public.auth_company_id()) = public.transcript_sources.company_id
)
with check (
  (select public.auth_role()) = 'company_admin'
  and public.transcript_sources.company_id is not null
  and (select public.auth_company_id()) = public.transcript_sources.company_id
);

drop policy if exists transcript_sources_delete_company_admin on public.transcript_sources;
create policy transcript_sources_delete_company_admin on public.transcript_sources
for delete to authenticated
using (
  (select public.auth_role()) = 'company_admin'
  and public.transcript_sources.company_id is not null
  and (select public.auth_company_id()) = public.transcript_sources.company_id
);

-- ---- transcript_aliases ---------------------------------------

drop policy if exists transcript_aliases_insert_company_admin on public.transcript_aliases;
create policy transcript_aliases_insert_company_admin on public.transcript_aliases
for insert to authenticated
with check (
  (select public.auth_role()) = 'company_admin'
  and public.transcript_aliases.company_id is not null
  and (select public.auth_company_id()) = public.transcript_aliases.company_id
);

drop policy if exists transcript_aliases_update_company_admin on public.transcript_aliases;
create policy transcript_aliases_update_company_admin on public.transcript_aliases
for update to authenticated
using (
  (select public.auth_role()) = 'company_admin'
  and public.transcript_aliases.company_id is not null
  and (select public.auth_company_id()) = public.transcript_aliases.company_id
)
with check (
  (select public.auth_role()) = 'company_admin'
  and public.transcript_aliases.company_id is not null
  and (select public.auth_company_id()) = public.transcript_aliases.company_id
);

drop policy if exists transcript_aliases_delete_company_admin on public.transcript_aliases;
create policy transcript_aliases_delete_company_admin on public.transcript_aliases
for delete to authenticated
using (
  (select public.auth_role()) = 'company_admin'
  and public.transcript_aliases.company_id is not null
  and (select public.auth_company_id()) = public.transcript_aliases.company_id
);

-- ---- meetings -------------------------------------------------
--
-- Routing and dismissing. USING pins the meeting the caller may
-- touch; WITH CHECK pins what it may become, so a company_admin can
-- neither reach an unrouted meeting nor send one anywhere but their
-- own company.

drop policy if exists meetings_update_company_admin on public.meetings;
create policy meetings_update_company_admin on public.meetings
for update to authenticated
using (
  (select public.auth_role()) = 'company_admin'
  and public.meetings.company_id is not null
  and (select public.auth_company_id()) = public.meetings.company_id
)
with check (
  (select public.auth_role()) = 'company_admin'
  and public.meetings.company_id is not null
  and (select public.auth_company_id()) = public.meetings.company_id
);
